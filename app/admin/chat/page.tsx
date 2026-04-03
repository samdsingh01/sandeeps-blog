'use client';

/**
 * app/admin/chat/page.tsx
 * =======================
 * Agent chat interface — talk to your blog agent directly.
 * Protected by CRON_SECRET key in the URL.
 *
 * Access: https://sandeeps.co/admin/chat?key=YOUR_CRON_SECRET
 *
 * The agent understands:
 *   "Write about X"            → adds keyword at priority 10
 *   "Skip X"                   → suppresses topic
 *   "Run now"                  → triggers content generation
 *   "Show me stats"            → performance summary
 *   "What did you do today?"   → today's activity log
 *   "Show drafts"              → lists unpublished posts
 *   "Approve [slug]"           → publishes a draft
 *   "Pause for 2 days"         → logs a pause
 *   "Focus on Course Creation" → shifts category focus
 *   "Boost priority of X"      → moves keyword to front of queue
 */

import { useState, useEffect, useRef, useCallback } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────────

interface Message {
  id:           string;
  role:         'user' | 'agent';
  content:      string;
  message_type: string;
  metadata?:    Record<string, unknown>;
  created_at:   string;
}

// ── Message type badge colours ─────────────────────────────────────────────────

const TYPE_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  escalation:     { bg: 'bg-red-100',    text: 'text-red-700',    label: '⚠️ Escalation' },
  post_published: { bg: 'bg-green-100',  text: 'text-green-700',  label: '✅ Published' },
  sync_complete:  { bg: 'bg-blue-100',   text: 'text-blue-700',   label: '🔄 Sync' },
  quality_issue:  { bg: 'bg-yellow-100', text: 'text-yellow-700', label: '🔍 Quality' },
  keyword_added:  { bg: 'bg-purple-100', text: 'text-purple-700', label: '🔑 Keyword' },
  patch_applied:  { bg: 'bg-indigo-100', text: 'text-indigo-700', label: '🩹 Patch' },
  info:           { bg: 'bg-gray-100',   text: 'text-gray-600',   label: 'ℹ️ Info' },
  chat:           { bg: '',              text: '',                 label: '' },
};

// ── Markdown-lite renderer ─────────────────────────────────────────────────────

function renderContent(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code class="bg-gray-100 text-gray-800 px-1 rounded text-xs font-mono">$1</code>')
    .replace(/\n/g, '<br/>');
}

// ── Suggestion pills ───────────────────────────────────────────────────────────

const SUGGESTIONS = [
  'What did you do today?',
  'Show me stats',
  'Show drafts',
  'What keywords are next?',
  'Run now',
];

// ── Component ──────────────────────────────────────────────────────────────────

export default function AgentChatPage() {
  const [messages,  setMessages]  = useState<Message[]>([]);
  const [input,     setInput]     = useState('');
  const [loading,   setLoading]   = useState(false);
  const [apiKey,    setApiKey]    = useState('');
  const [authed,    setAuthed]    = useState(false);
  const [keyInput,  setKeyInput]  = useState('');
  const [keyError,  setKeyError]  = useState('');
  const [polling,   setPolling]   = useState(false);

  const bottomRef   = useRef<HTMLDivElement>(null);
  const inputRef    = useRef<HTMLTextAreaElement>(null);
  const lastMsgId   = useRef<string | null>(null);

  // ── Extract key from URL on mount ───────────────────────────────────────────

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const k = params.get('key');
    if (k) { setApiKey(k); setAuthed(true); }
  }, []);

  // ── Load initial messages ────────────────────────────────────────────────────

  const loadMessages = useCallback(async (key: string, since?: string) => {
    const url = since
      ? `/api/agent/chat?key=${key}&since=${encodeURIComponent(since)}&limit=20`
      : `/api/agent/chat?key=${key}&limit=60`;

    const res = await fetch(url);
    if (!res.ok) return;
    const data = await res.json();
    return (data.messages ?? []) as Message[];
  }, []);

  useEffect(() => {
    if (!authed || !apiKey) return;
    loadMessages(apiKey).then((msgs) => {
      if (msgs) {
        setMessages(msgs);
        if (msgs.length > 0) lastMsgId.current = msgs[msgs.length - 1].created_at;
      }
    });
  }, [authed, apiKey, loadMessages]);

  // ── Poll for new agent messages every 8 seconds ──────────────────────────────

  useEffect(() => {
    if (!authed || !apiKey) return;
    const interval = setInterval(async () => {
      if (!lastMsgId.current) return;
      const newMsgs = await loadMessages(apiKey, lastMsgId.current);
      if (newMsgs && newMsgs.length > 0) {
        setMessages((prev) => [...prev, ...newMsgs]);
        lastMsgId.current = newMsgs[newMsgs.length - 1].created_at;
      }
    }, 8_000);
    return () => clearInterval(interval);
  }, [authed, apiKey, loadMessages]);

  // ── Auto-scroll to bottom on new messages ────────────────────────────────────

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Auth ─────────────────────────────────────────────────────────────────────

  const handleAuth = async () => {
    setKeyError('');
    const res = await fetch(`/api/agent/chat?key=${keyInput}&limit=1`);
    if (res.ok) {
      setApiKey(keyInput);
      setAuthed(true);
      // Update URL without reload
      const url = new URL(window.location.href);
      url.searchParams.set('key', keyInput);
      window.history.replaceState({}, '', url);
    } else {
      setKeyError('Wrong key — check your CRON_SECRET in Vercel env vars.');
    }
  };

  // ── Send message ─────────────────────────────────────────────────────────────

  const sendMessage = async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || loading) return;

    setInput('');
    setLoading(true);

    // Optimistic user bubble
    const tempId = `tmp-${Date.now()}`;
    const tempMsg: Message = {
      id:           tempId,
      role:         'user',
      content:      msg,
      message_type: 'chat',
      created_at:   new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempMsg]);

    try {
      const res  = await fetch(`/api/agent/chat?key=${apiKey}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ message: msg }),
      });
      const data = await res.json();

      // Replace temp + add agent reply
      const agentMsg: Message = {
        id:           `agent-${Date.now()}`,
        role:         'agent',
        content:      data.reply ?? 'Done.',
        message_type: 'chat',
        created_at:   new Date().toISOString(),
      };
      setMessages((prev) => [...prev.filter((m) => m.id !== tempId), agentMsg]);
      lastMsgId.current = agentMsg.created_at;

    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // ── Auth screen ──────────────────────────────────────────────────────────────

  if (!authed) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 w-full max-w-sm">
          <div className="text-center mb-6">
            <div className="text-3xl mb-2">🤖</div>
            <h1 className="text-white text-xl font-semibold">Agent Chat</h1>
            <p className="text-gray-400 text-sm mt-1">sandeeps.co blog agent</p>
          </div>
          <input
            type="password"
            placeholder="Enter your CRON_SECRET"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAuth()}
            className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-blue-500 mb-3"
            autoFocus
          />
          {keyError && <p className="text-red-400 text-xs mb-3">{keyError}</p>}
          <button
            onClick={handleAuth}
            className="w-full bg-blue-600 hover:bg-blue-500 text-white rounded-lg py-2.5 text-sm font-medium transition-colors"
          >
            Enter
          </button>
        </div>
      </div>
    );
  }

  // ── Chat UI ──────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">

      {/* Header */}
      <div className="border-b border-gray-800 px-4 py-3 flex items-center gap-3 bg-gray-900">
        <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-sm">🤖</div>
        <div>
          <div className="text-white text-sm font-semibold">Blog Agent</div>
          <div className="text-gray-400 text-xs">sandeeps.co · Always on</div>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
          <span className="text-gray-400 text-xs">live</span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">

        {messages.length === 0 && (
          <div className="text-center text-gray-500 mt-16 text-sm">
            <div className="text-4xl mb-3">👋</div>
            <p>Hey Sandeep! Ask me anything about the blog.</p>
            <p className="mt-1 text-gray-600 text-xs">New agent activity will appear here automatically.</p>
          </div>
        )}

        {messages.map((msg) => {
          const isUser  = msg.role === 'user';
          const badge   = TYPE_BADGE[msg.message_type] ?? TYPE_BADGE.chat;
          const showBadge = !isUser && msg.message_type !== 'chat';

          return (
            <div key={msg.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] ${isUser ? 'ml-12' : 'mr-12'}`}>

                {/* Badge for special agent messages */}
                {showBadge && (
                  <div className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium mb-1 ${badge.bg} ${badge.text}`}>
                    {badge.label}
                  </div>
                )}

                <div
                  className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                    isUser
                      ? 'bg-blue-600 text-white rounded-br-sm'
                      : 'bg-gray-800 text-gray-100 rounded-bl-sm'
                  }`}
                  dangerouslySetInnerHTML={{ __html: renderContent(msg.content) }}
                />

                <div className={`text-xs text-gray-600 mt-1 ${isUser ? 'text-right' : 'text-left'}`}>
                  {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            </div>
          );
        })}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-800 rounded-2xl rounded-bl-sm px-4 py-3">
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Suggestion pills */}
      {messages.length < 3 && (
        <div className="px-4 pb-2 flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => sendMessage(s)}
              className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 rounded-full px-3 py-1.5 transition-colors"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="border-t border-gray-800 p-4 bg-gray-900">
        <div className="flex gap-3 items-end max-w-3xl mx-auto">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask the agent anything… (Enter to send, Shift+Enter for new line)"
            rows={1}
            className="flex-1 bg-gray-800 text-white border border-gray-700 rounded-xl px-4 py-3 text-sm resize-none focus:outline-none focus:border-blue-500 placeholder-gray-500"
            style={{ maxHeight: '120px', overflowY: 'auto' }}
            disabled={loading}
            autoFocus
          />
          <button
            onClick={() => sendMessage()}
            disabled={loading || !input.trim()}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl w-10 h-10 flex items-center justify-center transition-colors flex-shrink-0"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 2L11 13"/>
              <path d="M22 2L15 22 11 13 2 9l20-7z"/>
            </svg>
          </button>
        </div>
        <p className="text-center text-gray-600 text-xs mt-2">
          This chat is only visible to you · Updates every 8 seconds
        </p>
      </div>
    </div>
  );
}
