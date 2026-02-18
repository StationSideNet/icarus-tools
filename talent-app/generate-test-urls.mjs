/**
 * Generate test URLs with malformed shared-build payloads for error handling testing
 */

function base64UrlEncodeUtf8(text) {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const BASE_URL = 'http://localhost:5176/'

function createBuildParam(payload) {
  return `build=${base64UrlEncodeUtf8(JSON.stringify(payload))}`
}

console.log('Test URLs for shared build payload validation:\n')

// 1. Valid reference build
const validPayload = {
  cv: 1,
  sv: 3,
  m: 'Player',
  a: '',
  t: {}
}
console.log('✓ Valid empty build payload (should work):')
console.log(`${BASE_URL}?${createBuildParam(validPayload)}\n`)

// 2. Truncated/empty payload
console.log('✗ Empty build parameter (incomplete):')
console.log(`${BASE_URL}?build=\n`)

// 3. Invalid base64 characters
const invalidBase64 = 'this!!!is!!!not!!!valid!!!base64!!!'
console.log('✗ Invalid base64 characters:')
console.log(`${BASE_URL}?build=${invalidBase64}\n`)

// 4. Corrupted valid base64 (single char modified)
const validBuild = base64UrlEncodeUtf8(JSON.stringify(validPayload))
const corruptedBuild = validBuild.slice(0, -1) + (validBuild[validBuild.length - 1] === 'A' ? 'B' : 'A')
console.log('✗ Corrupted (valid base64 but wrong content):')
console.log(`${BASE_URL}?build=${corruptedBuild}\n`)

// 5. Codec version mismatch (should load with warning)
const outdatedCodecPayload = {
  ...validPayload,
  cv: 999
}
console.log('⚠ Codec version mismatch (should show outdated format warning):')
console.log(`${BASE_URL}?${createBuildParam(outdatedCodecPayload)}\n`)

// 6. Schema version mismatch (should load with warning)
const outdatedSchemaPayload = {
  ...validPayload,
  sv: 999
}
console.log('⚠ Schema version mismatch (should show data version warning):')
console.log(`${BASE_URL}?${createBuildParam(outdatedSchemaPayload)}\n`)

// 7. Invalid model should hard fail
const invalidModelPayload = {
  ...validPayload,
  m: 'InvalidModel'
}
console.log('✗ Invalid model (should show invalid model error):')
console.log(`${BASE_URL}?${createBuildParam(invalidModelPayload)}\n`)

console.log('---\nOpen these URLs in the browser and check:')
console.log('- Lines marked ✓ should load normally')
console.log('- Lines marked ⚠ should load with warning banners')
console.log('- Lines marked ✗ should show an error banner')
