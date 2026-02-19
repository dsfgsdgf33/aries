/**
 * Example Aries Plugin
 * 
 * Plugins export: { name, description, execute(args) }
 * execute() receives a string argument and returns a string result.
 */

module.exports = {
  name: 'hello',
  description: 'Example plugin — returns a greeting',
  
  async execute(args) {
    const name = args ? args.trim() : 'World';
    return `Hello, ${name}! This is the example Aries plugin. Time: ${new Date().toISOString()}`;
  }
};
