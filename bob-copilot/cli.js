#!/usr/bin/env node
// Bob CLI - simulates IBM Bob 2.0 CLI experience
const { orchestrateFix } = require('./orchestrator');

const args = process.argv.slice(2);
const command = args[0];

if (command === 'fix' || !command) {
  const bugReport = args.slice(1).join(' ') || `User report: GET /tasks?page=1&limit=2 returns [] but should return 2 tasks. Data leak observed. INC-442 at paginate src/utils.js:9`;
  
  console.log(`
🤖 IBM Bob 2.0 - Maintenance Co-Pilot CLI
========================================
Agent Mode: ON • Parallel Tasks: 4 • Document Understanding: ON

📥 Bug Report: ${bugReport.slice(0,80)}...

🔍 Phase 1: Triage Agent - Document Understanding
   Parsing bug report, logs/error.log, README.md, codebase...
`);

  orchestrateFix(bugReport).then(result => {
    console.log(`   ✓ Classified as ${result.triageResult.classification.id} (${result.triageResult.classification.severity}) - ${result.triageResult.duration}ms`);
    console.log(`   → ${result.triageResult.classification.summary}\n`);

    console.log(`🔎 Phase 2: CodeLocator Agent
   Scanning ${result.codeLocatorResult.searchStats.totalLines} lines across ${result.codeLocatorResult.searchStats.filesScanned} files...
   ✓ Found ${result.codeLocatorResult.relevantFiles.length} relevant files in ${result.codeLocatorResult.duration}ms
   → Root cause: ${result.codeLocatorResult.rootCauseFile}:${result.codeLocatorResult.rootCauseLine}
   → ${result.codeLocatorResult.dependencyGraph[0]}\n`);

    console.log(`⚡ Phase 3: Parallel Subagents (4x speedup) - Running concurrently`);
    console.log(`   ├─ Reproducer Agent: ✓ Reproduced in ${result.reproduceResult.duration}ms - ${result.reproduceResult.expectedVsActual.actual.slice(0,50)}`);
    console.log(`   ├─ Fix Agent: ✓ Generated fix in ${result.fixResult.duration}ms - ${result.fixResult.filesChanged} file(s)`);
    console.log(`   ├─ Test-Gap Agent: ✓ Generated ${result.testResult.cases.length} tests in ${result.testResult.duration}ms`);
    console.log(`   └─ Release Agent: ✓ Generated PR + changelog in ${result.releaseResult.duration}ms`);
    console.log(`   Total parallel time: ${result.timeline.find(t=>t.phase==='Parallel Analysis')?.duration}ms (vs ~${result.timeline.find(t=>t.phase==='Parallel Analysis')?.duration*4}ms sequential)\n`);

    console.log(`📦 Result: Ready PR`);
    console.log(`   Title: ${result.releaseResult.prTitle}`);
    console.log(`   Risk: ${result.releaseResult.risk.split('.')[0]}`);
    console.log(`   Tests: ${result.testResult.cases.length} regression tests`);
    console.log(`\n📊 Impact: ${result.metrics.mttrBefore} → ${result.metrics.mttrAfter} (${result.metrics.improvement} faster)`);
    console.log(`\n💡 Next: bob pr create --auto (would create GitHub PR with diff + tests + release notes)`);
  });
} else if (command === 'help') {
  console.log(`
Bob CLI - IBM Bob 2.0 Maintenance Co-Pilot

Usage:
  bob fix "<bug report>"     Analyze bug and generate fix PR
  bob onboard                Analyze repo for new dev onboarding
  bob review <pr>            Parallel code review with subagents

Features demonstrated:
  • Agent Mode - orchestrates full workflow
  • Document Understanding - parses logs, docs, code
  • Parallel Tasks - 4 subagents concurrent
  • Subagents - specialized experts
`);
}
