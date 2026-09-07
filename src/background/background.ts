chrome.runtime.onInstalled.addListener(() => {
  console.log("AlgoForge extension installed.");
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "PING") {
    sendResponse({
      success: true,
      message: "AlgoForge background service is running."
    });
  }

  return true;
});