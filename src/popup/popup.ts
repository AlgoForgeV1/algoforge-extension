chrome.runtime.sendMessage(
  { type: "PING" },
  (response) => {
    if (chrome.runtime.lastError) {
      console.warn(chrome.runtime.lastError.message);
      return;
    }

    console.log("AlgoForge:", response);
  }
);