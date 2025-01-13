const path = require('path');
const webpack = require('webpack');
const CopyPlugin = require('copy-webpack-plugin');
const HtmlPlugin = require('html-webpack-plugin');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');

module.exports = {
    entry: {
        popup: path.resolve("./src/popup/popup.tsx"),
        options: path.resolve("./src/options/options.tsx"),
        background: path.resolve("./src/background/background.ts"),
    },
    module: {
        rules: [
            {
                use: "ts-loader",
                test: /\.tsx?$/,
                exclude: /node_modules/,
            },
            {
                use: ["style-loader", "css-loader"],
                test: /\.css$/i,
            },
            {
                type: "asset/resource",
                test: /\.(png|jpe?g|gif|svg|woff|woff2|eot|ttf)$/,
            }
        ]
    },
    plugins: [
        new webpack.ProvidePlugin({
            Buffer: ['buffer', 'Buffer'],
        }),
        new CleanWebpackPlugin({
            cleanStaleWEbpackAssets: false,
        }),
        new CopyPlugin({
            patterns: [
                {
                    from: path.resolve('src/static'),
                    to: path.resolve('dist'),
                }
            ]
        }),
        ...getHtmlPlugins(["popup", "options"]),
    ],
    resolve: {
        extensions: [".ts", ".tsx", ".js"],
        alias: {
            "@mdip/cipher/web": path.resolve(__dirname, "../../packages/cipher/src/cipher-web.js"),
            "@mdip/gatekeeper/client": path.resolve(__dirname, "../../packages/gatekeeper/src/gatekeeper-client.js"),
            "@mdip/keymaster/wallet/chrome": path.resolve(__dirname, "../../packages/keymaster/src/db/chrome.js"),
            "@mdip/keymaster": path.resolve(__dirname, "../../packages/keymaster/src/keymaster.js"),
        },
        fallback: {
            buffer: require.resolve("buffer")
        },
    },
    output: {
        filename: "[name].js",
        path: path.resolve("dist"),
    },
    optimization: {
        splitChunks: {
            chunks(chunk) {
                return chunk.name !== 'contentScript' && chunk.name !== 'background'
            }
        }
    }
}

function getHtmlPlugins(chunks) {
    return chunks.map(chunk => new HtmlPlugin({
        title: "MDIP Chrome Extension",
        filename: `${chunk}.html`,
        chunks: [chunk],
    }))
}