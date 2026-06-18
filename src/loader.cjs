"use strict";

let loaderModulePromise;

module.exports = function yukuLoader(source) {
  const callback = this.async();
  const loaderContext = Object.create(this);
  loaderContext.async = () => callback;

  loaderModulePromise ??= import("./index.js");

  loaderModulePromise.then(
    (loaderModule) => {
      Promise.resolve(loaderModule.default.call(loaderContext, source)).catch(callback);
    },
    callback
  );
};
