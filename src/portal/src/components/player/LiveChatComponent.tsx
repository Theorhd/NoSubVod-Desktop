import React, { useCallback, useEffect, useState } from 'react';

interface LiveChatComponentProps {
  liveId: string;
  chatScrollRef: React.RefObject<HTMLDivElement | null>;
}

function buildAuthQueryFromStorage(): string {
  const token = localStorage.getItem('nsv_token');
  const deviceId = localStorage.getItem('nsv_device_id');
  const parts: string[] = [];

  if (token) {
    parts.push(`t=${encodeURIComponent(token)}`);
  }
  if (deviceId) {
    parts.push(`d=${encodeURIComponent(deviceId)}`);
  }

  return parts.join('&');
}

const LiveChatComponent: React.FC<LiveChatComponentProps> = ({ liveId, chatScrollRef }) => {
  const [messages, setMessages] = useState<any[]>([]);
  const [twitchLinked, setTwitchLinked] = useState(false);
  const [twitchDisplayName, setTwitchDisplayName] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');

  useEffect(() => {
    fetch('/api/auth/twitch/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.linked) {
          setTwitchLinked(true);
          setTwitchDisplayName(data.userDisplayName || data.userLogin || '');
        }
      })
      .catch(() => {});
  }, []);

  const sendMessage = async () => {
    const msg = chatInput.trim();
    if (!msg || sending) return;

    setSending(true);
    setSendError('');
    try {
      const res = await fetch(`/api/live/${encodeURIComponent(liveId)}/chat/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg }),
      });

      if (res.ok) {
        setChatInput('');
      } else {
        const payload = await res.json().catch(() => null);
        setSendError(payload?.error || 'Message send failed.');
      }
    } catch (e) {
      console.error('Failed to send chat message', e);
      setSendError('Network error while sending message.');
    } finally {
      setSending(false);
    }
  };

  const handleWsMessage = useCallback(
    (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'clear_chat') {
          setMessages([]);
        } else if (data.type === 'clear_msg') {
          setMessages((prev) => prev.filter((m) => m.id !== data.id));
        } else if (data.id) {
          setMessages((prev) => {
            const next = [...prev, data];
            if (next.length > 150) return next.slice(-150);
            return next;
          });

          if (chatScrollRef.current) {
            const { scrollTop, scrollHeight, clientHeight } = chatScrollRef.current;
            if (scrollHeight - scrollTop - clientHeight < 150) {
              setTimeout(() => {
                if (chatScrollRef.current) {
                  chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
                }
              }, 50);
            }
          }
        }
      } catch (e) {
        console.error('Failed to parse chat message', e);
      }
    },
    [chatScrollRef]
  );

  useEffect(() => {
    let ws: WebSocket;
    let reconnectTimeout: ReturnType<typeof setTimeout>;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      const protocol = globalThis.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = globalThis.location.host;
      const authQuery = buildAuthQueryFromStorage();
      const query = authQuery ? `?${authQuery}` : '';
      const wsUrl = `${protocol}//${host}/api/live/${encodeURIComponent(liveId)}/chat/ws${query}`;
      ws = new WebSocket(wsUrl);

      ws.onmessage = handleWsMessage;
      ws.onclose = () => {
        if (!disposed) reconnectTimeout = setTimeout(connect, 3000);
      };
    };

    connect();
    return () => {
      disposed = true;
      clearTimeout(reconnectTimeout);
      if (ws) ws.close();
    };
  }, [liveId, handleWsMessage]);

  return (
    <>
      <div
        style={{
          padding: '15px',
          borderBottom: '1px solid #3a3a3d',
          fontWeight: 'bold',
          color: '#efeff1',
          fontSize: '0.9rem',
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <span>LIVE CHAT</span>
        <span style={{ fontSize: '0.75rem', color: '#4ade80' }}>Connected</span>
      </div>

      <div ref={chatScrollRef} style={{ flex: 1, overflowY: 'auto', padding: '10px' }}>
        {messages.map((message, idx) => (
          <div
            key={message.id || idx}
            style={{
              marginBottom: '8px',
              fontSize: '0.85rem',
              lineHeight: '1.4',
              wordWrap: 'break-word',
            }}
          >
            <span style={{ fontWeight: 'bold', color: message.color || '#bf94ff' }}>
              {message.displayName}:{' '}
            </span>
            <span style={{ color: '#efeff1' }}>{message.message}</span>
          </div>
        ))}
      </div>

      {twitchLinked && (
        <div
          style={{
            padding: '8px',
            borderTop: '1px solid #3a3a3d',
            display: 'flex',
            gap: '6px',
            flexShrink: 0,
          }}
        >
          <input
            type="text"
            value={chatInput}
            onChange={(e) => {
              setChatInput(e.target.value);
              if (sendError) setSendError('');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void sendMessage();
            }}
            placeholder={`Message as ${twitchDisplayName}`}
            maxLength={500}
            style={{
              flex: 1,
              padding: '6px 10px',
              background: '#1f1f23',
              border: '1px solid #3a3a3d',
              borderRadius: '4px',
              color: '#efeff1',
              fontSize: '0.85rem',
              outline: 'none',
            }}
          />
          <button
            onClick={() => void sendMessage()}
            disabled={!chatInput.trim() || sending}
            type="button"
            style={{
              padding: '6px 12px',
              background: '#9146ff',
              border: 'none',
              borderRadius: '4px',
              color: 'white',
              cursor: 'pointer',
              fontSize: '0.85rem',
              opacity: !chatInput.trim() || sending ? 0.5 : 1,
            }}
          >
            {sending ? '...' : 'Send'}
          </button>
        </div>
      )}

      {sendError && (
        <div
          style={{
            padding: '8px 10px',
            color: '#f87171',
            fontSize: '0.8rem',
            borderTop: '1px solid #3a3a3d',
            background: '#140f12',
          }}
        >
          {sendError}
        </div>
      )}
    </>
  );
};

export default LiveChatComponent;