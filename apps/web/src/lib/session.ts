/** Per-device exam session id. Stored in localStorage so a refresh resumes; a different device gets a different id. */
export function getSessionId() {
  try {
    let s = localStorage.getItem('eg_session');
    if (!s) {
      s = `${crypto.randomUUID()}`;
      localStorage.setItem('eg_session', s);
    }
    return s;
  } catch {
    return (window as unknown as { __egs?: string }).__egs ?? ((window as unknown as { __egs?: string }).__egs = crypto.randomUUID());
  }
}
export const sessionHeaders = () => ({ 'x-session-id': getSessionId() });
