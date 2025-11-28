const SIGN_IN_URL = "https://www.ourgroceries.com/sign-in";
const YOUR_LISTS_URL = "https://www.ourgroceries.com/your-lists/";

export interface LoginResult {
  authCookie: string;
  teamId: string;
}

export async function login(
  email: string,
  password: string
): Promise<LoginResult> {
  // Step 1: POST to /sign-in with form data
  const formData = new FormData();
  formData.append("emailAddress", email);
  formData.append("password", password);
  formData.append("action", "sign-in");

  const signInResponse = await fetch(SIGN_IN_URL, {
    method: "POST",
    body: formData,
    redirect: "manual", // Don't follow redirects automatically
  });

  // Step 2: Extract ourgroceries-auth cookie from response
  const setCookieHeader = signInResponse.headers.get("set-cookie");
  if (!setCookieHeader) {
    throw new Error("No cookies received from login. Check your credentials.");
  }

  // Parse the cookie value
  const authCookieMatch = setCookieHeader.match(
    /ourgroceries-auth=([^;]+)/
  );
  if (!authCookieMatch) {
    throw new Error("Auth cookie not found in response. Login may have failed.");
  }

  const authCookie = authCookieMatch[1];

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
