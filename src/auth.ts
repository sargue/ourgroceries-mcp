const SIGN_IN_URL = "https://www.ourgroceries.com/sign-in";
const YOUR_LISTS_URL = "https://www.ourgroceries.com/your-lists/";

export interface LoginResult {
  authCookie: string;
  teamId: string;
}

export async function login(
  email: string,
  password: string,
  debug: boolean = false
): Promise<LoginResult> {
  // Step 1: POST to /sign-in with form data
  const formData = new URLSearchParams();
  formData.append("emailAddress", email);
  formData.append("password", password);
  formData.append("action", "sign-in");

  if (debug) {
    console.error(`[DEBUG] Sending POST to ${SIGN_IN_URL}`);
    console.error(`[DEBUG] Email: ${email}`);
    console.error(`[DEBUG] Form data: ${formData.toString()}`);
  }

  const signInResponse = await fetch(SIGN_IN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formData.toString(),
    redirect: "manual", // Don't follow redirects - we need to capture cookies
  });

  if (debug) {
    console.error(`[DEBUG] Response status: ${signInResponse.status}`);
    console.error(`[DEBUG] Response headers:`, Object.fromEntries(signInResponse.headers.entries()));
  }

  // Step 2: Extract ourgroceries-auth cookie from response
  // Node.js fetch uses 'getSetCookie()' to get set-cookie headers
  const setCookieHeaders = signInResponse.headers.getSetCookie
    ? signInResponse.headers.getSetCookie()
    : [];

  if (debug) {
    console.error(`[DEBUG] Set-Cookie headers (getSetCookie): ${setCookieHeaders.length}`);
    setCookieHeaders.forEach((cookie, i) => {
      console.error(`[DEBUG]   Cookie ${i}: ${cookie.substring(0, 100)}...`);
    });
  }

  if (setCookieHeaders.length === 0) {
    // Fallback: try regular get
    const setCookieHeader = signInResponse.headers.get("set-cookie");
    if (debug) {
      console.error(`[DEBUG] Set-Cookie header (get): ${setCookieHeader ? 'present' : 'null'}`);
    }
    if (setCookieHeader) {
      setCookieHeaders.push(setCookieHeader);
    }
  }

  if (setCookieHeaders.length === 0) {
    throw new Error("No cookies received from login. Check your credentials.");
  }

  // Find the ourgroceries-auth cookie
  let authCookie: string | undefined;
  for (const cookie of setCookieHeaders) {
    const match = cookie.match(/ourgroceries-auth=([^;]+)/);
    if (match) {
      authCookie = match[1];
      if (debug) {
        console.error(`[DEBUG] Found auth cookie: ${authCookie.substring(0, 20)}...`);
      }
      break;
    }
  }

  if (!authCookie) {
    throw new Error("Auth cookie not found in response. Login may have failed.");
  }

  // Step 3: GET /your-lists/ with the auth cookie to extract team ID
  const listsResponse = await fetch(YOUR_LISTS_URL, {
    headers: {
      Cookie: `ourgroceries-auth=${authCookie}`,
    },
  });

  if (!listsResponse.ok) {
    throw new Error(
      `Failed to fetch lists page: ${listsResponse.status} ${listsResponse.statusText}`
    );
  }

  const htmlContent = await listsResponse.text();

  // Step 4: Parse team ID from HTML using regex
  const teamIdMatch = htmlContent.match(/g_teamId = "([^"]+)"/);
  if (!teamIdMatch) {
    throw new Error(
      "Could not extract team ID from response. The page format may have changed."
    );
  }

  const teamId = teamIdMatch[1];

  return {
    authCookie,
    teamId,
  };
}
