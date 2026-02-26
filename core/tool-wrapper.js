const nativeVerifier = require('./native-verification');
const { performance } = require('perf_hooks');

/**
 * Wraps tool functions with verification tracking
 */
function wrapToolWithVerification(toolName, toolFunction, isShellTool = false) {
  return async function(...args) {
    const startTime = performance.now();
    let result;
    let success = false;

    try {
      // Track usage
      nativeVerifier.trackToolUsage(toolName, isShellTool);

      // Execute the tool
      result = await toolFunction.apply(this, args);
      success = result && result.success !== false;

      return result;
    } catch (error) {
      success = false;
      result = { success: false, output: error.message };
      return result;
    } finally {
      const duration = performance.now() - startTime;
      
      // Track performance and failure rates
      nativeVerifier.trackPerformance(toolName, duration, success);
      nativeVerifier.updateFailureRate(toolName, success);
    }
  };
}

/**
 * Wraps all tools in an object with verification tracking
 */
function wrapAllTools(toolsObject) {
  const wrappedTools = {};
  
  for (const [toolName, toolFunction] of Object.entries(toolsObject)) {
    if (typeof toolFunction === 'function') {
      const isShellTool = toolName === 'shell' || toolName === 'launch';
      wrappedTools[toolName] = wrapToolWithVerification(toolName, toolFunction, isShellTool);
    } else {
      wrappedTools[toolName] = toolFunction;
    }
  }

  return wrappedTools;
}

module.exports = {
  wrapToolWithVerification,
  wrapAllTools
};