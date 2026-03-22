use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::Path;
use axum::response::IntoResponse;
use futures::{SinkExt, StreamExt};
use std::collections::VecDeque;
use std::time::Duration;
use twitch_irc::login::StaticLoginCredentials;
use twitch_irc::message::ServerMessage;
use twitch_irc::{ClientConfig, SecureTCPTransport, TwitchIRCClient};

pub async fn handle_chat_ws(ws: WebSocketUpgrade, Path(login): Path<String>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, login))
}

async fn handle_socket(socket: WebSocket, login: String) {
    let config = ClientConfig::default();
    let (mut incoming_messages, client) =
        TwitchIRCClient::<SecureTCPTransport, StaticLoginCredentials>::new(config);

    if let Err(e) = client.join(login.clone()) {
        eprintln!("[Chat] Failed to join channel: {}", e);
        return;
    }

    eprintln!("[Chat] Connected to channel chat: {}", login);

    let (mut sender, mut receiver) = socket.split();

    // Task to handle incoming WebSocket messages (mostly heartbeats or close)
    let mut ws_read_task = tokio::spawn(async move {
        while let Some(msg) = receiver.next().await {
            if let Ok(Message::Close(_)) = msg {
                break;
            }
        }
    });

    // Task to handle Twitch messages with batching and a Ring Buffer
    let mut twitch_read_task = tokio::spawn(async move {
        // Ring buffer to hold processed messages before they are batched/flushed.
        // Reusing the same allocation to avoid repeated memory allocations.
        let mut ring_buffer: VecDeque<serde_json::Value> = VecDeque::with_capacity(200);

        // Interval for batching messages (e.g., every 150ms)
        let mut flush_interval = tokio::time::interval(Duration::from_millis(150));
        // Avoid immediate tick
        flush_interval.tick().await;

        loop {
            tokio::select! {
                // Receive message from Twitch
                Some(message) = incoming_messages.recv() => {
                    match message {
                        ServerMessage::Privmsg(msg) => {
                            let color_str = msg
                                .name_color
                                .map(|c| format!("#{:02X}{:02X}{:02X}", c.r, c.g, c.b));

                            let badges: Vec<_> = msg.badges.iter().map(|b| serde_json::json!({
                                "name": b.name,
                                "version": b.version,
                            })).collect();

                            let emotes: Vec<_> = msg.emotes.iter().map(|e| serde_json::json!({
                                "id": e.id,
                                "startIndex": e.char_range.start,
                                "endIndex": e.char_range.end,
                            })).collect();

                            let out = serde_json::json!({
                                "type": "msg",
                                "id": msg.message_id,
                                "sender": msg.sender.login,
                                "displayName": msg.sender.name,
                                "color": color_str,
                                "message": msg.message_text,
                                "badges": badges,
                                "emotes": emotes,
                                "timestamp": msg.server_timestamp.timestamp_millis(),
                            });

                            if ring_buffer.len() < ring_buffer.capacity() {
                                ring_buffer.push_back(out);
                            } else {
                                // If buffer is full, we could drop oldest or flush immediately.
                                // Here we flush to keep the chat responsive.
                                if flush_messages(&mut sender, &mut ring_buffer).await.is_err() {
                                    break;
                                }
                                ring_buffer.push_back(out);
                            }
                        }
                        ServerMessage::ClearChat(_msg) => {
                            ring_buffer.push_back(serde_json::json!({ "type": "clear_chat" }));
                        }
                        ServerMessage::ClearMsg(msg) => {
                            ring_buffer.push_back(serde_json::json!({
                                "type": "clear_msg",
                                "id": msg.message_id,
                            }));
                        }
                        _ => {}
                    }

                    // If we have a lot of messages, flush immediately without waiting for the timer
                    if ring_buffer.len() >= 100
                        && flush_messages(&mut sender, &mut ring_buffer).await.is_err()
                    {
                        break;
                    }
                }
                // Periodic flush
                _ = flush_interval.tick() => {
                    if !ring_buffer.is_empty()
                        && flush_messages(&mut sender, &mut ring_buffer).await.is_err()
                    {
                        break;
                    }
                }
            }
        }
    });

    tokio::select! {
        _ = &mut ws_read_task => {
            eprintln!("[Chat] WebSocket closed for {}", login);
            twitch_read_task.abort();
        },
        _ = &mut twitch_read_task => {
            eprintln!("[Chat] Twitch reader task finished for {}", login);
            ws_read_task.abort();
        },
    }

    eprintln!("[Chat] Disconnected from channel: {}", login);
}

/// Helper to flush messages from the ring buffer to the WebSocket as a batch.
async fn flush_messages(
    sender: &mut futures::stream::SplitSink<WebSocket, Message>,
    buffer: &mut VecDeque<serde_json::Value>,
) -> Result<(), ()> {
    if buffer.is_empty() {
        return Ok(());
    }

    // We send a batch to reduce the number of messages sent over the WebSocket.
    let batch = serde_json::json!({
        "type": "batch",
        "messages": buffer.drain(..).collect::<Vec<_>>()
    });

    if let Ok(json_str) = serde_json::to_string(&batch) {
        if sender.send(Message::Text(json_str)).await.is_err() {
            return Err(());
        }
    }

    Ok(())
}
