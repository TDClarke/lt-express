const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const CopyWebpackPlugin = require("copy-webpack-plugin");

module.exports = {
  mode: "production",
  entry: {
    index: "./src/index.js",
    code: "./src/sandbox/code.js"
  },
  experiments: { outputModule: true },
  output: {
    path: path.resolve(__dirname, "dist"),
    module: true,
    filename: "[name].js",
    clean: true
  },
  externalsType: "module",
  externals: {
    "add-on-sdk-document-sandbox": "add-on-sdk-document-sandbox",
    "express-document-sdk": "express-document-sdk",
    "https://new.express.adobe.com/static/add-on-sdk/sdk.js":
      "https://new.express.adobe.com/static/add-on-sdk/sdk.js"
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: "src/index.html",
      filename: "index.html",
      scriptLoading: "module",
      excludeChunks: ["code"]
    }),
    new CopyWebpackPlugin({
      patterns: [{ from: "src/manifest.json", to: "manifest.json" }]
    })
  ]
};
