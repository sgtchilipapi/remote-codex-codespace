const express = require("express");
const { execFile } = require("node:child_process");

const app = express();
const port = process.env.PORT || 3000;

app.get("/test", (req, res) => {
  const codespace = process.env.CODESPACE;

  if (!codespace) {
    return res.status(500).json({
      error: "CODESPACE environment variable is missing",
    });
  }

  execFile(
    "gh",
    [
      "codespace",
      "ssh",
      "-c",
      codespace,
      "--",
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=15",
      "hostname && pwd"
    ],
    (error, stdout, stderr) => {
      if (error) {
        return res.status(500).json({
          error: error.message,
          code: error.code,
          killed: error.killed,
          signal: error.signal,
          stdout,
          stderr,
        });
      }

      res.type("text/plain").send(stdout);
    }
  );
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Listening on ${port}`);
});