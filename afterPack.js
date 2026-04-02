const { execFileSync } = require("child_process");
const path = require("path");

exports.default = async function (context) {
  const appPath = context.appOutDir;
  console.log("Stripping extended attributes and resource forks from:", appPath);

  // Remove all extended attributes recursively
  execFileSync("xattr", ["-cr", appPath], { stdio: "inherit" });

  // Also remove any ._ resource fork files that macOS creates
  try {
    execFileSync("find", [appPath, "-name", "._*", "-delete"], { stdio: "inherit" });
  } catch (_) {}

  console.log("Extended attributes stripped successfully");
};
