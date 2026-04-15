import { google } from 'googleapis';

/**
 * Validates the access token and returns an authenticated Gmail client.
 */
function getGmailClient(accessToken: string) {
  if (!accessToken) {
    throw new Error('Access token is required to initialize Gmail client.');
  }

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });

  return google.gmail({ version: 'v1', auth: oauth2Client });
}

export interface FormattedEmail {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
}

export interface FormattedEmailDetail extends FormattedEmail {
  body: string;
}

/**
 * Helper to decode base64url data from Gmail API.
 */
function decodeBase64(data: string): string {
  if (!data) return '';
  // Gmail uses base64url, so replace - with + and _ with /
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString('utf8');
}

/**
 * Recursive helper to extract the message body from Gmail multi-part payload.
 * Priority: text/plain > text/html
 */
function extractBodyFromPayload(payload: any): { plain: string; html: string } {
  let plain = '';
  let html = '';

  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    plain = decodeBase64(payload.body.data);
  } else if (payload.mimeType === 'text/html' && payload.body?.data) {
    html = decodeBase64(payload.body.data);
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      const result = extractBodyFromPayload(part);
      if (result.plain) plain += (plain ? '\n' : '') + result.plain;
      if (result.html) html += (html ? '\n' : '') + result.html;
    }
  }

  return { plain, html };
}

/**
 * Strip HTML tags for clean LLM context if only HTML is available.
 */
function stripHtml(html: string): string {
  if (!html) return '';
  return html
    .replace(/<style[^>]*>.*<\/style>/gms, '')
    .replace(/<script[^>]*>.*<\/script>/gms, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Fetch a list of messages based on a query (q) and format them concisely.
 */
export async function getEmailSummaries(accessToken: string, query: string = '', maxResults: number = 5): Promise<FormattedEmail[]> {
  const gmail = getGmailClient(accessToken);

  try {
    const listResponse = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults,
    });

    const messages = listResponse.data.messages || [];
    const detailedMessages = await Promise.all(
      messages.map(async (msg) => {
        const details = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id!,
          format: 'metadata',
          metadataHeaders: ['Subject', 'From', 'Date'],
        });

        const headers = details.data.payload?.headers || [];
        const subject = headers.find((h) => h.name === 'Subject')?.value || '(No Subject)';
        const from = headers.find((h) => h.name === 'From')?.value || '(Unknown Sender)';
        const date = headers.find((h) => h.name === 'Date')?.value || '';
        const snippet = details.data.snippet || '';

        return {
          id: msg.id!,
          threadId: msg.threadId!,
          subject,
          from,
          date,
          snippet,
        };
      })
    );

    return detailedMessages;
  } catch (error: any) {
    const errorMsg = error.message?.toLowerCase() || String(error).toLowerCase();
    console.error('[GMAIL] API error:', error.message || error);

    if (errorMsg.includes('401') || errorMsg.includes('credential') || errorMsg.includes('unauthorized')) {
      throw new Error('GOOGLE_AUTH_EXPIRED');
    }
    
    if (errorMsg.includes('403') || errorMsg.includes('insufficient permissions')) {
      throw new Error('GMAIL_PERMISSION_DENIED');
    }

    if (errorMsg.includes('gmail api has not been used') || errorMsg.includes('disabled')) {
      throw new Error('GMAIL_API_DISABLED');
    }

    throw new Error(`Gmail API Error: ${error.message || 'Failed to fetch emails'}`);
  }
}

/**
 * Specifically fetch unread messages.
 */
export async function getUnreadEmails(accessToken: string, maxResults: number = 5): Promise<FormattedEmail[]> {
  return getEmailSummaries(accessToken, 'is:unread', maxResults);
}

/**
 * Fetch the full content of a specific message and extract a usable body.
 */
export async function getFullEmailContent(accessToken: string, messageId: string): Promise<FormattedEmailDetail> {
  const gmail = getGmailClient(accessToken);

  try {
    const response = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    });

    const data = response.data;
    const headers = data.payload?.headers || [];
    const subject = headers.find(h => h.name === 'Subject')?.value || '(No Subject)';
    const from = headers.find(h => h.name === 'From')?.value || '(Unknown Sender)';
    const date = headers.find(h => h.name === 'Date')?.value || '';
    
    const bodies = extractBodyFromPayload(data.payload);
    // Prefer text/plain, fallback to stripped text/html
    let body = bodies.plain || stripHtml(bodies.html) || data.snippet || '(No content)';

    return {
      id: messageId,
      threadId: data.threadId!,
      subject,
      from,
      date,
      snippet: data.snippet || '',
      body,
    };
  } catch (error: any) {
    console.error(`[GMAIL] Failed to fetch message ${messageId}:`, error.message || error);
    throw error; // Let caller handle auth/api errors
  }
}
