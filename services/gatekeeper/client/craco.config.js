const webpack = require('webpack');

module.exports = {
  webpack: {
    configure: (webpackConfig) => {
      webpackConfig.resolve.fallback = {
        ...webpackConfig.resolve.fallback,
        crypto: require.resolve('crypto-browserify'),
        stream: require.resolve('stream-browserify'),
        process: require.resolve('process/browser.js'),
      };

      webpackConfig.resolve.alias = {
        ...(webpackConfig.resolve.alias || {}),
        'process/browser': 'process/browser.js'
      };

      webpackConfig.plugins = (webpackConfig.plugins || []).concat([
        new webpack.ProvidePlugin({
          process: 'process/browser.js',
        }),
      ]);

      return webpackConfig;
    },
  },
};

