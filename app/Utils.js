'use strict';

/**
 * Returns stringified JSON from error
 * @param {Object} error - Error to be stringified.
 */
function errorMessage(error) { return JSON.stringify({error}) }

exports.errorMessage = errorMessage;

/**
 * Check whether `val` is an object.
 * @param {} val - Value to be checked.
 */
function isObject(val) { return typeof val === 'object' && val !== null; }

exports.isObject = isObject;

/**
 * Check whether object is empty.
 * @param {Object} val - Value to be checked.
 */
function isEmpty(val) { return Object.keys(val).length === 0; }
exports.isEmpty = isEmpty;
