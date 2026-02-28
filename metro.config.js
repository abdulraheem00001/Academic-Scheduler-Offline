const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

config.resolver = {
  ...config.resolver,
  resolveRequest: (context, moduleName, platform) => {
    if (
      platform === "web" &&
      moduleName === "./support/isBuffer" &&
      context.originModulePath.includes(path.join("node_modules", "util"))
    ) {
      return {
        type: "sourceFile",
        filePath: path.resolve(__dirname, "shims/isBufferStub.js"),
      };
    }
    return context.resolveRequest(context, moduleName, platform);
  },
};

module.exports = config;
