import assert from "node:assert";
import test from "node:test";
import { parseRecipientList } from "../src/notify-email-alerts.js";

test("parseRecipientList empty", () => {
  assert.deepStrictEqual(parseRecipientList(""), []);
  assert.deepStrictEqual(parseRecipientList(undefined), []);
});

test("parseRecipientList splits comma semicolon newline", () => {
  assert.deepStrictEqual(parseRecipientList("a@x.com,b@y.com"), [
    "a@x.com",
    "b@y.com",
  ]);
  assert.deepStrictEqual(parseRecipientList("a@x.com; b@y.com "), [
    "a@x.com",
    "b@y.com",
  ]);
  assert.deepStrictEqual(parseRecipientList("a@x.com\nb@y.com"), [
    "a@x.com",
    "b@y.com",
  ]);
});
