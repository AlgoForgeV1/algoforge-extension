interface ProblemPayload {
  problemNumber: string;
  problemTitle: string;
  difficulty: string;
  language: string;
  code: string;
  url: string;
}

interface LeetCodeSubmission {
  id: string;
  statusDisplay: string;
  lang: string;
  runtime: number | null;
  memory: number | null;
  timestamp: number;
  url: string | null;
  isPending: boolean;
}

interface LeetCodeSubmissionDetail {
  id: string;
  runtime: number | null;
  runtimeDisplay: string | null;
  runtimePercentile: number | null;
  memory: number | null;
  memoryDisplay: string | null;
  memoryPercentile: number | null;
  code: string | null;
  timestamp: number;
  statusCode: number | null;
  statusDisplay: string | null;
  lang: {
    name: string;
    verboseName: string;
  } | null;
  question: {
    questionId: string;
    questionFrontendId: string;
    title: string;
    titleSlug: string;
    difficulty: string;
  } | null;
}

const LEETCODE_GRAPHQL = "https://leetcode.com/graphql/";

function log(...args: unknown[]) {
  console.log("[AlgoForge]", ...args);
}

/**
 * Get the current LeetCode CSRF token.
 *
 * We intentionally do NOT read or send LEETCODE_SESSION
 * to the AlgoForge backend.
 */
async function getCsrfToken(): Promise<string | null> {
  const cookie = await chrome.cookies.get({
    url: "https://leetcode.com/",
    name: "csrftoken",
  });

  return cookie?.value ?? null;
}

/**
 * Make an authenticated GraphQL request to LeetCode.
 *
 * The browser supplies the logged-in LeetCode cookies through
 * credentials: "include".
 */
async function leetcodeGraphQL<T>(
  query: string,
  variables: Record<string, unknown>,
  operationName: string,
): Promise<T> {
  const csrfToken = await getCsrfToken();

  if (!csrfToken) {
    throw new Error(
      "LeetCode CSRF token was not found. Make sure you are logged into LeetCode.",
    );
  }

  const response = await fetch(LEETCODE_GRAPHQL, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-CSRFToken": csrfToken,
      Referer: "https://leetcode.com/",
    },
    body: JSON.stringify({
      operationName,
      variables,
      query,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `LeetCode GraphQL request failed with HTTP ${response.status}`,
    );
  }

  const body = await response.json();

  if (body.errors?.length) {
    throw new Error(
      body.errors[0]?.message || "LeetCode GraphQL request failed",
    );
  }

  if (!body.data) {
    throw new Error("LeetCode returned no GraphQL data");
  }

  return body.data as T;
}

/**
 * Get the current user's submissions for a problem.
 *
 * IMPORTANT:
 * questionSubmissionList is authenticated/current-user data.
 * It is NOT an arbitrary public-user history endpoint.
 */
async function getProblemSubmissions(
  titleSlug: string,
): Promise<LeetCodeSubmission[]> {
  const query = `
    query submissionList(
      $offset: Int!
      $limit: Int!
      $lastKey: String
      $questionSlug: String!
    ) {
      questionSubmissionList(
        offset: $offset
        limit: $limit
        lastKey: $lastKey
        questionSlug: $questionSlug
      ) {
        submissions {
          id
          statusDisplay
          lang
          runtime
          timestamp
          url
          isPending
          memory
        }
      }
    }
  `;

  const data = await leetcodeGraphQL<{
    questionSubmissionList: {
      submissions: LeetCodeSubmission[];
    };
  }>(
    query,
    {
      offset: 0,
      limit: 20,
      lastKey: null,
      questionSlug: titleSlug,
    },
    "submissionList",
  );

  return data.questionSubmissionList?.submissions ?? [];
}

/**
 * Get full details for one submission.
 */
async function getSubmissionDetails(
  submissionId: string,
): Promise<LeetCodeSubmissionDetail> {
  const query = `
    query submissionDetails($submissionId: Int!) {
      submissionDetails(submissionId: $submissionId) {
        id
        runtime
        runtimeDisplay
        runtimePercentile
        memory
        memoryDisplay
        memoryPercentile
        code
        timestamp
        statusCode
        statusDisplay

        lang {
          name
          verboseName
        }

        question {
          questionId
          questionFrontendId
          title
          titleSlug
          difficulty
        }
      }
    }
  `;

  const data = await leetcodeGraphQL<{
    submissionDetails: LeetCodeSubmissionDetail | null;
  }>(
    query,
    {
      submissionId: Number(submissionId),
    },
    "submissionDetails",
  );

  if (!data.submissionDetails) {
    throw new Error(
      `LeetCode did not return details for submission ${submissionId}`,
    );
  }

  return data.submissionDetails;
}

/**
 * Extract the problem slug from a LeetCode problem URL.
 *
 * Example:
 * https://leetcode.com/problems/two-sum/
 *
 * -> two-sum
 */
function getTitleSlug(url: string): string | null {
  try {
    const parsed = new URL(url);

    const match = parsed.pathname.match(/^\/problems\/([^/]+)/);

    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Fetch authenticated submissions and their details
 * for the current LeetCode problem.
 */
async function getAuthenticatedProblemData(
  problem: ProblemPayload,
): Promise<{
  titleSlug: string;
  submissions: LeetCodeSubmission[];
  details: LeetCodeSubmissionDetail[];
}> {
  const titleSlug = getTitleSlug(problem.url);

  if (!titleSlug) {
    throw new Error("Could not determine the LeetCode problem slug.");
  }

  log("Fetching authenticated submissions for:", titleSlug);

  const submissions = await getProblemSubmissions(titleSlug);

  log("Found submissions:", submissions);

  const details: LeetCodeSubmissionDetail[] = [];

  /*
   * Start with all returned submissions.
   *
   * We limit this to 20 because the query itself currently requests
   * the latest 20 submissions.
   */
  for (const submission of submissions) {
    try {
      const detail = await getSubmissionDetails(submission.id);

      details.push(detail);

      log("Fetched submission details:", submission.id);
    } catch (error) {
      console.warn(
        "[AlgoForge] Could not fetch submission:",
        submission.id,
        error,
      );
    }
  }

  return {
    titleSlug,
    submissions,
    details,
  };
}

/**
 * Existing Monaco extraction.
 */
async function getCodeFromPage(tabId: number): Promise<string> {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: () => {
      try {
        const monaco = (window as any).monaco;

        if (monaco?.editor?.getEditors) {
          const editors = monaco.editor.getEditors();

          if (editors.length > 0) {
            const values = editors
              .map((editor: any) => editor.getValue?.() || "")
              .filter(Boolean);

            if (values.length > 0) {
              return values.join("\n");
            }
          }
        }
      } catch (error) {
        console.warn("[AlgoForge] Monaco extraction failed", error);
      }

      /*
       * DOM fallback.
       */
      const lines = Array.from(
        document.querySelectorAll(".monaco-editor .view-lines .view-line"),
      );

      if (lines.length > 0) {
        return lines
          .map((line) => line.textContent || "")
          .join("\n");
      }

      return "";
    },
  });

  return results[0]?.result || "";
}

/**
 * Message handler.
 */
chrome.runtime.onMessage.addListener(
  (message, sender, sendResponse) => {
    if (message?.type !== "ANALYZE_PROBLEM") {
      return;
    }

    const tabId = sender.tab?.id;

    if (!tabId) {
      sendResponse({
        success: false,
        error: "No LeetCode tab found.",
      });

      return;
    }

    (async () => {
      try {
        const problem = message.problem as ProblemPayload;

        log("Analyze requested:", problem);

        /*
         * Existing code capture.
         */
        const code = await getCodeFromPage(tabId);

        const updatedProblem: ProblemPayload = {
          ...problem,
          code,
        };

        /*
         * NEW:
         * Get authenticated LeetCode submissions.
         */
        const leetcodeData =
          await getAuthenticatedProblemData(updatedProblem);

        const payload = {
          problem: updatedProblem,

          leetcode: {
            titleSlug: leetcodeData.titleSlug,
            submissions: leetcodeData.submissions,
            details: leetcodeData.details,
          },
        };

        console.log(
          "[AlgoForge] AUTHENTICATED ANALYSIS PAYLOAD:",
          payload,
        );

        sendResponse({
          success: true,
          data: payload,
        });
      } catch (error) {
        console.error("[AlgoForge] Analyze failed:", error);

        sendResponse({
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to analyze LeetCode problem.",
        });
      }
    })();

    return true;
  },
);