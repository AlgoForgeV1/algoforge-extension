chrome.runtime.onInstalled.addListener(() => {
  console.log("AlgoForge extension installed.");
});

/*
 * Read the current solution from LeetCode's Monaco editor.
 *
 * Content scripts run in an isolated world, so the page's `window.monaco`
 * object is not reliably available directly to them. The service worker
 * therefore executes this small function in the page's MAIN world.
 */
async function getSolutionCode(
  tabId: number
): Promise<string> {
  const results =
    await chrome.scripting.executeScript({
      target: {
        tabId
      },
      world: "MAIN",
      func: () => {
        /*
         * Current LeetCode uses Monaco for the code editor.
         * Depending on the page bundle, Monaco may be exposed on
         * window or reachable through the editor DOM.
         */

        try {
          const page =
            window as typeof window & {
              monaco?: {
                editor?: {
                  getEditors?: () => Array<{
                    getValue?: () => string;
                  }>;
                };
              };
            };

          const editors =
            page.monaco?.editor?.getEditors?.();

          if (editors?.length) {
            /*
             * There can be more than one Monaco instance on the page.
             * The last editor is normally the active LeetCode editor.
             */

            for (
              let i = editors.length - 1;
              i >= 0;
              i -= 1
            ) {
              const value =
                editors[i]?.getValue?.();

              if (
                typeof value === "string" &&
                value.trim().length > 0
              ) {
                return value;
              }
            }

            /*
             * Empty solution is still valid. Return the empty
             * string instead of treating it as an error.
             */

            return "";
          }

          /*
           * Fallback: look for Monaco's model data on the page.
           * This is intentionally conservative so we don't scrape
           * arbitrary text from LeetCode.
           */

          const editorNodes =
            document.querySelectorAll(
              ".monaco-editor"
            );

          if (editorNodes.length) {
            /*
             * Monaco keeps the rendered code in line elements.
             * This fallback reconstructs visible lines when the
             * Monaco API is not exposed.
             */

            const lines: string[] = [];

            for (
              const editorNode of Array.from(
                editorNodes
              )
            ) {
              const lineNodes =
                editorNode.querySelectorAll(
                  ".view-lines .view-line"
                );

              if (!lineNodes.length) {
                continue;
              }

              for (
                const lineNode of Array.from(
                  lineNodes
                )
              ) {
                lines.push(
                  lineNode.textContent ?? ""
                );
              }

              if (lines.length > 0) {
                return lines.join("\n");
              }
            }
          }

          return "";
        } catch (error) {
          console.debug(
            "AlgoForge: unable to read Monaco editor.",
            error
          );

          return "";
        }
      }
    });

  const code =
    results?.[0]?.result;

  return typeof code === "string"
    ? code
    : "";
}

chrome.runtime.onMessage.addListener(
  (message, sender, sendResponse) => {
    if (message?.type === "PING") {
      sendResponse({
        success: true,
        message:
          "AlgoForge background service is running."
      });

      return true;
    }

    if (
      message?.type ===
      "ANALYZE_PROBLEM"
    ) {
      const tabId =
        sender.tab?.id;

      if (
        typeof tabId !== "number"
      ) {
        sendResponse({
          success: false,
          message:
            "The active LeetCode tab could not be identified."
        });

        return true;
      }

      /*
       * Keep this payload shape stable. Your teammate can connect
       * the backend API to it later.
       */

      void (async () => {
        try {
          const code =
            await getSolutionCode(
              tabId
            );

          const problem =
            message.problem ?? {};

          const payload = {
            problemNumber:
              String(
                problem.number ?? ""
              ),

            problemTitle:
              String(
                problem.title ?? ""
              ),

            difficulty:
              String(
                problem.difficulty ?? ""
              ),

            language:
              String(
                problem.language ?? ""
              ),

            code,

            url:
              String(
                problem.url ?? ""
              )
          };

          /*
           * For now this is intentionally only captured.
           * Backend integration will be added when your teammate
           * exposes the analysis endpoint.
           */

          console.log(
            "AlgoForge analysis payload:",
            payload
          );

          sendResponse({
            success: true,
            message:
              "Problem and solution captured.",
            payload
          });
        } catch (error) {
          console.error(
            "AlgoForge: solution capture failed.",
            error
          );

          sendResponse({
            success: false,
            message:
              "Could not capture the LeetCode solution."
          });
        }
      })();

      return true;
    }

    return true;
  }
);
