/**
 * agent/agentchat.ts
 * ==================
 * Writes agent-initiated messages to the agent_messages table so they appear
 * in the /admin/chat UI. Every significant agent event — escalations, post
 * published, daily sync complete, quality issues found — calls sendAgentMessage()
 * so Sandeep sees a real-time feed of what the agent is doing.
 *
 * SUPABASE TABLE (run this SQL once):
 * -----------------------------------
 * create table agent_messages (
 *   id          uuid primary key default gen_random_uuid(),
 *   role        text not null check (role in ('user','agent')),
 *   content     text not null,
 *   message_type text not null default 'chat',
 *   -- message_type: chat | escalation | post_published | sync_complete |
 *   --               quality_issue | keyword_added | patch_applied | info
 *   metadata    jsonb,
 *   created_at  timestamptz not null default now()
 * );
 * create index agent_messages_created_at_idx on agent_messages (created_at desc);
 */

import { getServiceClient } from '../lib/supabase';

export type MessageRole = 'user' | 'agent';
export type MessageType =
  | 'chat'
  | 'escalation'
  | 'post_published'
  | 'sync_complete'
  | 'quality_issue'
  | 'keyword_added'
  | 'patch_applied'
  | 'info';

export interface AgentMessage {
  id:           string;
  role:         MessageRole;
  content:      string;
  message_type: MessageType;
  metadata?:    Record<string, unknown>;
  created_at:   string;
}

/**
 * Write a message from the agent into the chat history.
 * Fire-and-forget safe — errors are logged but never thrown.
 */
export async function sendAgentMessage(
  content:      string,
  messageType:  MessageType = 'chat',
  metadata?:    Record<string, unknown>,
): Promise<void> {
  try {
    const db = getServiceClient();
    await db.from('agent_messages').insert({
      role:         'agent',
      content,
      message_type: messageType,
      metadata:     metadata ?? null,
    });
  } catch (err) {
    console.error('[AgentChat] Failed to write agent message:', err);
  }
}

/**
 * Fetch the last N messages for display in the chat UI.
 */
export async function getRecentMessages(limit = 50): Promise<AgentMessage[]> {
  try {
    const db = getServiceClient();
    const { data, error } = await db
      .from('agent_messages')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    // Return in chronological order for display
    return ((data ?? []) as AgentMessage[]).reverse();
  } catch (err) {
    console.error('[AgentChat] Failed to fetch messages:', err);
    return [];
  }
}

/**
 * Write a user message into the history (called by the chat API route).
 */
export async function saveUserMessage(
  content:  string,
  metadata?: Record<string, unknown>,
): Promise<AgentMessage | null> {
  try {
    const db = getServiceClient();
    const { data, error } = await db
      .from('agent_messages')
      .insert({
        role:         'user',
        content,
        message_type: 'chat',
        metadata:     metadata ?? null,
      })
      .select()
      .single();

    if (error) throw error;
    return data as AgentMessage;
  } catch (err) {
    console.error('[AgentChat] Failed to save user message:', err);
    return null;
  }
}
