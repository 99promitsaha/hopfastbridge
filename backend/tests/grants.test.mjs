import test from 'node:test';
import assert from 'node:assert/strict';
import { grantSchema } from '../dist/routes/grants.routes.js';
const valid = { title: 'Arc builder tools', handle: 'arc_builder', projectUrl: 'https://example.com/demo', description: 'An Arc developer tool that helps builders test their USDC payment flows.', milestone: 'Ship a working public demo and publish the integration guide.', targetUsdc: '500.25' };
test('accepts a concrete micro-grant request', () => assert.equal(grantSchema.safeParse(valid).success, true));
test('rejects unsafe links and invalid targets', () => {
  for (const projectUrl of ['not a url', 'javascript:alert(1)', 'http://example.com', 'data:text/html,hi']) assert.equal(grantSchema.safeParse({ ...valid, projectUrl }).success, false);
  for (const targetUsdc of ['0', '-1', '1e3', '0.0000001', '1000001']) assert.equal(grantSchema.safeParse({ ...valid, targetUsdc }).success, false);
});
test('requires an X handle and a meaningful milestone', () => {
  assert.equal(grantSchema.safeParse({ ...valid, handle: '@invalid' }).success, false);
  assert.equal(grantSchema.safeParse({ ...valid, milestone: '' }).success, false);
});
