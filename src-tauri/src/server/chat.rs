use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::Path;
use axum::response::IntoResponse;
use futures::{SinkExt, StreamExt};
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

    eprintln!("[Chat] Connected to channel chat");

    let (mut sender, mut receiver) = socket.split();

    let mut ws_read_task = tokio::spawn(async move {
        while let Some(msg) = receiver.next().await {
            if let Ok(Message::Close(_)) = msg {
                break;
            }
        }
    });

    let mut twitch_read_task = tokio::spawn(async move {
        while let Some(message) = incoming_messages.recv().await {
            match message {
                ServerMessage::Privmsg(msg) => {
                    let mut badges_list = Vec::new();
                    for badge in msg.badges {
                        badges_list.push(serde_json::json!({
                            "name": badge.name,
                            "version": badge.version,
                        }));
                    }
                    
                    let mut emotes_list = Vec::new();
                    for emote in msg.emotes {
                        emotes_list.push(serde_json::json!({
                            "id": emote.id,
                            "startIndex": emote.char_range.start,
                            "endIndex": emote.char_range.end,
                        }));
                    }

                    let color_str = msg
                        .name_color
                        .map(|c| format!("#{:02X}{:02X}{:02X}", c.r, c.g, c.b));

                    let out = serde_json::json!({
                        "id": msg.message_id,
                        "sender": msg.sender.login,
                        "displayName": msg.sender.name,
                        "color": color_str,
                        "message": msg.message_text,
                        "badges": badges_list,
                        "emotes": emotes_list,
                        "timestamp": msg.server_timestamp.timestamp_millis(),
                    });

                    if sender
                        .send(Message::Text(out.to_string()))
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
                ServerMessage::ClearChat(_msg) => {
                     let out = serde_json::json!({
                        "type": "clear_chat",
                    });
                    let _ = sender.send(Message::Text(out.to_string())).await;
                }
                ServerMessage::ClearMsg(msg) => {
                     let out = serde_json::json!({
                        "type": "clear_msg",
                        "id": msg.message_id,
                    });
                    let _ = sender.send(Message::Text(out.to_string())).await;
                }
                _ => {}
            }
        }
    });

    tokio::select! {
        _ = &mut ws_read_task => {
            eprintln!("[Chat] WebSocket closed by client");
            twitch_read_task.abort();
        },
        _ = &mut twitch_read_task => {
            eprintln!("[Chat] Twitch IRC client stopped");
            ws_read_task.abort();
        },
    }

    eprintln!("[Chat] Disconnected from channel chat");
}
