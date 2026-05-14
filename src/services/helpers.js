const { v4: uuidv4 } = require('uuid');

// Generates order reference like LSB-A3F9K2
function generateOrderRef() {
  return 'LSB-' + uuidv4().replace(/-/g, '').toUpperCase().slice(0, 6);
}

// Generates a 4-digit locker access code
function generateAccessCode() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

module.exports = { generateOrderRef, generateAccessCode };
