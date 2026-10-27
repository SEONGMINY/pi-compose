import test from 'node:test';
import assert from 'node:assert/strict';
import { workmuxPiForkSupported } from '../src/launch.ts';

test('workmux Pi Fork requires documented 0.1.277+',()=>{
  assert.equal(workmuxPiForkSupported('workmux 0.1.276'),false);
  assert.equal(workmuxPiForkSupported('workmux 0.1.277'),true);
  assert.equal(workmuxPiForkSupported('workmux v0.1.278'),true);
  assert.equal(workmuxPiForkSupported('workmux 0.2.0'),true);
  assert.equal(workmuxPiForkSupported('workmux 0.1.24'),false);
  assert.equal(workmuxPiForkSupported('unexpected output'),false);
});
