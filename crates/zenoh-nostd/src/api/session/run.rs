use heapless::Vec as HVec;
use zenoh_proto::{exts::Value, fields::Reliability, fields::WireExpr, msgs::*, *};

use crate::{
    api::{
        callbacks::{ZCallbacks, ZDynCallback},
        query::QueryableQuery,
        session::Session,
    },
    config::ZSessionConfig,
    io::transport::ZTransportLinkTx,
    session::{GetResponse, Sample},
};

// Maximum number of local declarations to advertise per Interest.
// Increase if more simultaneous subscribers/queryables are needed.
const MAX_DECLARE_KEYS: usize = 32;

impl<'res, Config> Session<'res, Config>
where
    Config: ZSessionConfig,
{
    pub async fn run(&self) -> core::result::Result<(), SessionError> {
        // Announce our interest to the peer: request current + future declarations
        // for all entity types (K|S|Q|T) with aggregate snapshot notification (M).
        self.driver
            .tx()
            .await
            .send(core::iter::once(NetworkMessage {
                reliability: Reliability::default(),
                qos: exts::QoS::default(),
                body: NetworkBody::Interest(Interest {
                    id: 0,
                    mode: InterestMode::CurrentFuture,
                    inner: InterestInner {
                        options: InterestOptions::KEYEXPRS.options
                            | InterestOptions::SUBSCRIBERS.options
                            | InterestOptions::QUERYABLES.options
                            | InterestOptions::TOKENS.options
                            | InterestOptions::AGGREGATE.options,
                        wire_expr: None,
                    },
                    ..Default::default()
                }),
            }))
            .await?;

        let driver = &self.driver;
        self.driver
            .run(&self.state, async |_, state, msg, _| {
                match msg.body {
                    NetworkBody::Push(Push {
                        wire_expr,
                        payload: PushBody::Put(Put { payload, .. }),
                        ..
                    }) => {
                        let ke = wire_expr.suffix;
                        let ke = keyexpr::new(ke)?;
                        let sample = Sample::new(ke, payload);

                        for cb in state.sub_callbacks.intersects(ke) {
                            cb.call_try_sync(&sample).await;
                        }
                    }
                    NetworkBody::Response(Response {
                        rid,
                        wire_expr,
                        payload,
                        ..
                    }) => {
                        let ke = wire_expr.suffix;
                        let ke = keyexpr::new(ke)?;
                        let response = match payload {
                            ResponseBody::Reply(Reply {
                                payload: PushBody::Put(Put { payload, .. }),
                                ..
                            }) => GetResponse::Ok(Sample::new(ke, payload)),
                            ResponseBody::Err(Err { payload, .. }) => {
                                GetResponse::Err(Sample::new(ke, payload))
                            }
                        };

                        if let Some(cb) = state.get_callbacks.get(rid) {
                            cb.call_try_sync(&response).await;
                        }
                    }
                    NetworkBody::ResponseFinal(ResponseFinal { rid, .. }) => {
                        state.get_callbacks.remove(rid)?;
                        // TODO: also close channels
                    }
                    NetworkBody::Request(Request {
                        id,
                        wire_expr,
                        payload:
                            RequestBody::Query(Query {
                                parameters, body, ..
                            }),
                        ..
                    }) => {
                        let ke = wire_expr.suffix;
                        let ke = keyexpr::new(ke)?;
                        let query = QueryableQuery::new(
                            self,
                            id,
                            ke,
                            if parameters.is_empty() {
                                None
                            } else {
                                Some(parameters)
                            },
                            match body {
                                Some(Value { payload, .. }) => Some(payload),
                                None => None,
                            },
                        );

                        let count = state.queryable_callbacks.intersects(ke).count();
                        state.queryable_callbacks.set_counter(id, count)?;
                        for cb in state.queryable_callbacks.intersects(ke) {
                            cb.call(&query).await;
                        }
                    }
                    NetworkBody::Interest(Interest {
                        id: iid,
                        mode,
                        inner,
                        ..
                    }) => {
                        // The peer is cancelling an existing interest; nothing to do.
                        if mode == InterestMode::Final {
                            return Ok(());
                        }

                        let opts = InterestOptions { options: inner.options };
                        let key_filter: Option<&keyexpr> = inner
                            .wire_expr
                            .as_ref()
                            .filter(|we| we.scope == 0 && !we.suffix.is_empty())
                            .and_then(|we| keyexpr::new(we.suffix).ok());

                        // Collect subscriber keys first (synchronously) to avoid
                        // holding an iterator borrow across async send calls.
                        if opts.subscribers() {
                            let mut pairs =
                                HVec::<(u32, &'static keyexpr), MAX_DECLARE_KEYS>::new();
                            for pair in state.sub_callbacks.iter_keys() {
                                let _ = pairs.push(pair);
                            }
                            for (sub_id, sub_ke) in pairs {
                                if key_filter.map_or(true, |fke| sub_ke.intersects(fke)) {
                                    driver
                                        .tx()
                                        .await
                                        .send(core::iter::once(NetworkMessage {
                                            reliability: Reliability::default(),
                                            qos: exts::QoS::default(),
                                            body: NetworkBody::Declare(Declare {
                                                id: Some(iid),
                                                body: DeclareBody::DeclareSubscriber(
                                                    DeclareSubscriber {
                                                        id: sub_id,
                                                        wire_expr: WireExpr::from(sub_ke),
                                                    },
                                                ),
                                                ..Default::default()
                                            }),
                                        }))
                                        .await?;
                                }
                            }
                        }

                        // Collect queryable keys similarly.
                        if opts.queryables() {
                            let mut pairs =
                                HVec::<(u32, &'static keyexpr), MAX_DECLARE_KEYS>::new();
                            for pair in state.queryable_callbacks.iter_keys() {
                                let _ = pairs.push(pair);
                            }
                            for (q_id, q_ke) in pairs {
                                if key_filter.map_or(true, |fke| q_ke.intersects(fke)) {
                                    driver
                                        .tx()
                                        .await
                                        .send(core::iter::once(NetworkMessage {
                                            reliability: Reliability::default(),
                                            qos: exts::QoS::default(),
                                            body: NetworkBody::Declare(Declare {
                                                id: Some(iid),
                                                body: DeclareBody::DeclareQueryable(
                                                    DeclareQueryable {
                                                        id: q_id,
                                                        wire_expr: WireExpr::from(q_ke),
                                                        ..Default::default()
                                                    },
                                                ),
                                                ..Default::default()
                                            }),
                                        }))
                                        .await?;
                                }
                            }
                        }

                        // Signal end of the current-snapshot with DeclareFinal.
                        driver
                            .tx()
                            .await
                            .send(core::iter::once(NetworkMessage {
                                reliability: Reliability::default(),
                                qos: exts::QoS::default(),
                                body: NetworkBody::Declare(Declare {
                                    id: Some(iid),
                                    body: DeclareBody::DeclareFinal(DeclareFinal {}),
                                    ..Default::default()
                                }),
                            }))
                            .await?;
                    }
                    NetworkBody::InterestFinal(_) => {
                        // The peer confirmed its interest is cancelled. Nothing to do.
                    }
                    NetworkBody::Declare(Declare { body, .. }) => {
                        match body {
                            DeclareBody::DeclareFinal(_) => {
                                // Remote peer's current-snapshot is complete.
                                // Future: invoke user callbacks for snapshot completion.
                            }
                            _ => {
                                // Future: track remote declarations for discovery.
                            }
                        }
                    }
                }

                Ok::<(), SessionError>(())
            })
            .await
            .map_err(|e| e.flatten_map())
    }
}
