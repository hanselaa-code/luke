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
    
    // Check for insufficient permissions (scope not granted)
    if (errorMsg.includes('403') || errorMsg.includes('insufficient permissions')) {
      throw new Error('GMAIL_PERMISSION_DENIED');
    }

    // Check for API disabled
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
