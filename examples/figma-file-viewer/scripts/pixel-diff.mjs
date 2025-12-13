#!/usr/bin/env node
/**
 * Pixel-Perfect Diff Comparison Tool
 *
 * Compares rendered screenshots against golden images (Figma exports)
 * and generates detailed diff reports.
 *
 * Usage:
 *   node scripts/pixel-diff.mjs <actual-dir> <expected-dir> [--threshold=0]
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createCanvas, loadImage } from 'canvas';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configuration
const DEFAULT_THRESHOLD = 0; // 0 = pixel-perfect match required
const DIFF_COLOR = { r: 255, g: 0, b: 255, a: 255 }; // Magenta for differences

/**
 * Compare two images and return diff statistics
 */
async function compareImages(actualPath, expectedPath, options = {}) {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;

  // Load images
  const actual = await loadImage(actualPath);
  const expected = await loadImage(expectedPath);

  // Check dimensions
  if (actual.width !== expected.width || actual.height !== expected.height) {
    return {
      match: false,
      error: `Dimension mismatch: ${actual.width}x${actual.height} vs ${expected.width}x${expected.height}`,
      diffPixels: -1,
      totalPixels: -1,
      diffPercent: 100,
    };
  }

  // Create canvases
  const width = actual.width;
  const height = actual.height;
  const totalPixels = width * height;

  const actualCanvas = createCanvas(width, height);
  const expectedCanvas = createCanvas(width, height);
  const diffCanvas = createCanvas(width, height);

  const actualCtx = actualCanvas.getContext('2d');
  const expectedCtx = expectedCanvas.getContext('2d');
  const diffCtx = diffCanvas.getContext('2d');

  actualCtx.drawImage(actual, 0, 0);
  expectedCtx.drawImage(expected, 0, 0);

  const actualData = actualCtx.getImageData(0, 0, width, height);
  const expectedData = expectedCtx.getImageData(0, 0, width, height);
  const diffData = diffCtx.createImageData(width, height);

  let diffPixels = 0;

  // Compare pixel by pixel
  for (let i = 0; i < actualData.data.length; i += 4) {
    const rDiff = Math.abs(actualData.data[i] - expectedData.data[i]);
    const gDiff = Math.abs(actualData.data[i + 1] - expectedData.data[i + 1]);
    const bDiff = Math.abs(actualData.data[i + 2] - expectedData.data[i + 2]);
    const aDiff = Math.abs(actualData.data[i + 3] - expectedData.data[i + 3]);

    const maxDiff = Math.max(rDiff, gDiff, bDiff, aDiff);

    if (maxDiff > threshold) {
      // Mark as different
      diffData.data[i] = DIFF_COLOR.r;
      diffData.data[i + 1] = DIFF_COLOR.g;
      diffData.data[i + 2] = DIFF_COLOR.b;
      diffData.data[i + 3] = DIFF_COLOR.a;
      diffPixels++;
    } else {
      // Copy expected pixel (dimmed)
      diffData.data[i] = expectedData.data[i] * 0.3;
      diffData.data[i + 1] = expectedData.data[i + 1] * 0.3;
      diffData.data[i + 2] = expectedData.data[i + 2] * 0.3;
      diffData.data[i + 3] = expectedData.data[i + 3];
    }
  }

  diffCtx.putImageData(diffData, 0, 0);

  const diffPercent = (diffPixels / totalPixels) * 100;

  return {
    match: diffPixels <= threshold,
    diffPixels,
    totalPixels,
    diffPercent,
    diffCanvas,
    width,
    height,
  };
}

/**
 * Save diff image
 */
async function saveDiffImage(diffCanvas, outputPath) {
  const buffer = diffCanvas.toBuffer('image/png');
  fs.writeFileSync(outputPath, buffer);
}

/**
 * Compare all images in directories
 */
async function compareDirectories(actualDir, expectedDir, outputDir, options = {}) {
  console.log('\n=== Pixel-Perfect Comparison ===\n');
  console.log(`Actual:   ${actualDir}`);
  console.log(`Expected: ${expectedDir}`);
  console.log(`Output:   ${outputDir}`);
  console.log(`Threshold: ${options.threshold ?? DEFAULT_THRESHOLD} (0 = exact match)\n`);

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Get image files
  const actualFiles = fs.existsSync(actualDir)
    ? fs.readdirSync(actualDir).filter(f => f.endsWith('.png'))
    : [];

  const expectedFiles = fs.existsSync(expectedDir)
    ? fs.readdirSync(expectedDir).filter(f => f.endsWith('.png'))
    : [];

  if (actualFiles.length === 0) {
    console.log('No actual screenshots found.');
    console.log('Run feature verification tests first:');
    console.log('  npm run test:e2e -- --grep "Feature Verification"');
    return [];
  }

  if (expectedFiles.length === 0) {
    console.log('No expected (golden) images found.');
    console.log('Export reference images from Figma to:');
    console.log(`  ${expectedDir}`);
    return [];
  }

  const results = [];

  // Compare each actual image
  for (const file of actualFiles) {
    const actualPath = path.join(actualDir, file);

    // Find matching expected image
    if (!expectedFiles.includes(file)) {
      results.push({
        file,
        match: false,
        error: 'No matching golden image',
        diffPixels: -1,
        totalPixels: -1,
        diffPercent: 100,
      });
      continue;
    }

    const expectedPath = path.join(expectedDir, file);

    console.log(`Comparing: ${file}`);

    try {
      const result = await compareImages(actualPath, expectedPath, options);
      result.file = file;

      // Save diff image if there are differences
      if (!result.match && result.diffCanvas) {
        const diffPath = path.join(outputDir, `diff-${file}`);
        await saveDiffImage(result.diffCanvas, diffPath);
        result.diffImagePath = diffPath;
      }

      results.push(result);

      const status = result.match ? '✅ MATCH' : '❌ DIFF';
      console.log(`  ${status} - ${result.diffPixels} pixels (${result.diffPercent.toFixed(2)}%)`);

    } catch (error) {
      results.push({
        file,
        match: false,
        error: error.message,
        diffPixels: -1,
        totalPixels: -1,
        diffPercent: 100,
      });
      console.log(`  ❌ ERROR - ${error.message}`);
    }
  }

  return results;
}

/**
 * Generate comparison report
 */
function generateComparisonReport(results, options = {}) {
  const timestamp = new Date().toISOString();
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;

  const passed = results.filter(r => r.match).length;
  const failed = results.filter(r => !r.match).length;
  const total = results.length;

  let report = `# Pixel-Perfect Comparison Report

Generated: ${timestamp}
Threshold: ${threshold} (0 = exact match)

## Summary

| Metric | Value |
|--------|-------|
| Total Compared | ${total} |
| Passed | ${passed} |
| Failed | ${failed} |
| Pass Rate | ${total > 0 ? ((passed/total)*100).toFixed(1) : 0}% |

## Detailed Results

`;

  for (const result of results) {
    const status = result.match ? '✅ PASS' : '❌ FAIL';
    report += `### ${status} ${result.file}\n\n`;

    if (result.error) {
      report += `**Error:** ${result.error}\n\n`;
    } else {
      report += `| Metric | Value |\n`;
      report += `|--------|-------|\n`;
      report += `| Dimensions | ${result.width}x${result.height} |\n`;
      report += `| Total Pixels | ${result.totalPixels.toLocaleString()} |\n`;
      report += `| Different Pixels | ${result.diffPixels.toLocaleString()} |\n`;
      report += `| Difference | ${result.diffPercent.toFixed(4)}% |\n\n`;

      if (result.diffImagePath) {
        const relativePath = path.basename(result.diffImagePath);
        report += `**Diff Image:** [${relativePath}](./${relativePath})\n\n`;
      }
    }

    report += `---\n\n`;
  }

  // Recommendations based on results
  report += `## Recommendations

`;

  if (failed === 0) {
    report += `✨ **Perfect match!** All images match the golden references.\n`;
  } else {
    report += `### Issues to Address

`;
    const failedResults = results.filter(r => !r.match);
    for (const result of failedResults) {
      report += `- **${result.file}**: `;
      if (result.error) {
        report += `${result.error}\n`;
      } else if (result.diffPercent < 0.1) {
        report += `Minor differences (${result.diffPercent.toFixed(4)}%) - likely antialiasing\n`;
      } else if (result.diffPercent < 1) {
        report += `Small differences (${result.diffPercent.toFixed(2)}%) - check edges and gradients\n`;
      } else {
        report += `Significant differences (${result.diffPercent.toFixed(1)}%) - needs investigation\n`;
      }
    }

    report += `
### Investigation Steps

1. Review diff images to identify specific areas
2. Check rendering logic for affected features
3. Verify gradient/effect calculations
4. Test across different browsers
5. Consider adjusting threshold for acceptable variations
`;
  }

  return report;
}

// Main execution
async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2 && !args.includes('--help')) {
    // Use default directories
    const actualDir = path.join(__dirname, '../test-results/feature-screenshots');
    const expectedDir = path.join(__dirname, '../test-fixtures/golden');
    const outputDir = path.join(__dirname, '../test-results/pixel-diff');

    const results = await compareDirectories(actualDir, expectedDir, outputDir);

    if (results.length > 0) {
      const report = generateComparisonReport(results);
      const reportPath = path.join(outputDir, 'comparison-report.md');
      fs.writeFileSync(reportPath, report);
      console.log(`\n📄 Report saved to: ${reportPath}`);

      const passed = results.filter(r => r.match).length;
      console.log(`\n📊 Result: ${passed}/${results.length} passed`);
    }

    return;
  }

  if (args.includes('--help')) {
    console.log(`
Pixel-Perfect Diff Comparison Tool

Usage:
  node scripts/pixel-diff.mjs <actual-dir> <expected-dir> [options]

Options:
  --threshold=N   Pixel difference threshold (default: 0)
  --help          Show this help

Examples:
  # Exact pixel match
  node scripts/pixel-diff.mjs ./actual ./expected

  # Allow small differences (e.g., for antialiasing)
  node scripts/pixel-diff.mjs ./actual ./expected --threshold=5
`);
    return;
  }

  const actualDir = args[0];
  const expectedDir = args[1];
  const outputDir = path.join(path.dirname(actualDir), 'pixel-diff');

  // Parse options
  const options = {};
  for (const arg of args.slice(2)) {
    if (arg.startsWith('--threshold=')) {
      options.threshold = parseInt(arg.split('=')[1], 10);
    }
  }

  const results = await compareDirectories(actualDir, expectedDir, outputDir, options);

  if (results.length > 0) {
    const report = generateComparisonReport(results, options);
    const reportPath = path.join(outputDir, 'comparison-report.md');
    fs.writeFileSync(reportPath, report);
    console.log(`\n📄 Report saved to: ${reportPath}`);

    const passed = results.filter(r => r.match).length;
    const exitCode = passed === results.length ? 0 : 1;
    console.log(`\n📊 Result: ${passed}/${results.length} passed`);
    process.exit(exitCode);
  }
}

main().catch(console.error);
