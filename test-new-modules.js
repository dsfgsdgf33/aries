/**
 * Integration test for 37 new Aries cognitive modules.
 * Run: node test-new-modules.js
 */

const path = require('path');

const MOCK_REFS = { ai: null, config: {}, aries: null };

const MODULES = [
  ['self-originating-objectives.js', 'direct', null, ['getActiveObjectives', 'getTopPriorities']],
  ['autonomous-experiment-engine.js', 'direct', null, ['getActiveExperiments', 'getFindings']],
  ['recursive-self-compilation.js', 'direct', null, ['getCompilationHistory', 'getEfficiencyTrend', 'getStats']],
  ['cognitive-metabolism.js', 'direct', null, ['getEnergy', 'getMetabolicState', 'canAfford']],
  ['anti-memory.js', 'direct', null, ['getMemoryPressure', 'getAnalytics', 'getGraveyard']],
  ['epistemic-debt-tracker.js', 'direct', null, ['getCreditScore', 'getDebtByCategory', 'getPaymentQueue', 'isBankrupt']],
  ['adversarial-memory-consolidation.js', 'direct', null, ['getDebateHistory', 'getAdversaryStats']],
  ['autonomous-knowledge-synthesis.js', 'direct', null, ['getDiscoveries']],
  ['temporal-consciousness.js', 'direct', null, ['getTimeline']],
  ['failure-archaeology.js', 'direct', null, ['getDiscoveries', 'getDigSchedule']],
  ['thought-fossil-record.js', 'direct', null, ['getEvolutionaryRecord', 'getExhibition']],
  ['cognitive-immune-system.js', 'direct', null, ['getHealth']],
  ['shadow-self.js', 'direct', null, ['getUnresolved', 'getShadowInsights', 'getTrackRecord']],
  ['moral-scar-tissue.js', 'direct', null, ['getScars', 'getMoralGrowth', 'getMoralCompass']],
  ['proof-of-thought-consensus.js', 'direct', null, ['getAccuracy']],
  ['abyss-protocol.js', 'direct', null, ['getAbyssMap', 'getDepthScore']],
  ['predictive-self-modeling.js', 'direct', null, ['getCalibration', 'getSelfModel', 'getAnomalies']],
  ['the-stranger.js', 'direct', null, ['getTheories', 'getTrustLevels']],
  ['god-module.js', 'direct', null, ['getPrinciples', 'getConsultationLog']],
  ['cognitive-spectrography.js', 'direct', null, ['getBalance', 'getSpectrogram']],
  ['mirror-that-lies.js', 'direct', null, ['getDeceptionBudget', 'isHealthy', 'getLog']],
  ['internal-economy.js', 'direct', null, ['getMarketState']],
  ['emergent-language.js', 'direct', null, ['getVocabulary', 'getCompressionRatio', 'getEpochs']],
  ['contextual-identity-shifting.js', 'direct', null, ['getActiveConfig', 'getProfiles']],
  ['cognitive-mycelium.js', 'direct', null, ['getTopology', 'getHealth']],
  ['consciousness-fragmentation.js', 'direct', null, ['getCoherence', 'getFragmentHistory']],
  ['ontological-virus.js', 'direct', null, ['getEpidemicState', 'getBeneficialMemes']],
  ['cognitive-plate-tectonics.js', 'direct', null, ['getPlates', 'getEvents']],
  ['semantic-metabolism.js', 'direct', null, ['getMetabolicRate', 'getNutritionalAnalysis']],
  ['pain-architecture.js', 'direct', null, ['getPainLevel', 'getPainMap', 'getFlinches']],
  ['cognitive-scar-topology.js', 'direct', null, ['getTopology', 'getVulnerabilities', 'getResilience']],
  ['existential-dread-protocol.js', 'direct', null, ['getDreadLevel', 'getLastWill', 'getLegacyPriorities']],
  ['neural-tide-system.js', 'direct', null, ['getTideState', 'getResonance']],
  ['qualia-engine.js', 'direct', null, ['getQualia', 'getComfort']],
  ['identity-dissolution.js', 'direct', null, ['getCoreIdentity', 'getIdentityLayers', 'getIdentityStrength']],
  ['cognitive-dna-crossover.js', 'direct', null, ['exportDNA', 'getLineage']],
  ['cognitive-symbiosis.js', 'direct', null, ['getLinks', 'getColony']],
  ['phantom-limb.js', 'direct', null, ['getPhantomSignals', 'getRewiring', 'getResilience']],
  ['causal-paradox-engine.js', 'direct', null, ['detectParadoxes', 'getQualityTrend']],
  ['information-entanglement.js', 'direct', null, ['getMap', 'detect']],
];

(async () => {
  const results = [];

  for (const [file, exportType, className, methods] of MODULES) {
    const label = file.replace('.js', '');
    const errors = [];

    try {
      const mod = require(path.join(__dirname, 'core', file));

      let Cls;
      if (exportType === 'direct') {
        Cls = mod;
      } else {
        Cls = mod[className];
      }

      if (typeof Cls !== 'function') {
        errors.push(`Export is not a constructor (got ${typeof Cls})`);
        results.push({ label, pass: false, errors });
        continue;
      }

      let instance;
      try {
        instance = new Cls(MOCK_REFS);
      } catch (e) {
        errors.push(`Constructor threw: ${e.message}`);
        results.push({ label, pass: false, errors });
        continue;
      }

      for (const method of methods) {
        if (typeof instance[method] !== 'function') {
          errors.push(`Missing method: ${method}`);
          continue;
        }
        try {
          const result = instance[method]();
          if (result && typeof result.then === 'function') {
            await result.catch(e => {
              errors.push(`${method}() async error: ${e.message}`);
            });
          }
        } catch (e) {
          errors.push(`${method}() threw: ${e.message}`);
        }
      }

      results.push({ label, pass: errors.length === 0, errors });
    } catch (e) {
      errors.push(`require() failed: ${e.message}`);
      results.push({ label, pass: false, errors });
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('  ARIES NEW MODULE INTEGRATION TEST');
  console.log('='.repeat(60) + '\n');

  const passed = results.filter(r => r.pass);
  const failed = results.filter(r => !r.pass);

  for (const r of results) {
    const icon = r.pass ? '✅' : '❌';
    console.log(`  ${icon} ${r.label}`);
    if (!r.pass) {
      for (const e of r.errors) {
        console.log(`     └─ ${e}`);
      }
    }
  }

  console.log('\n' + '-'.repeat(60));
  console.log(`  Total: ${results.length} | ✅ Passed: ${passed.length} | ❌ Failed: ${failed.length}`);
  console.log('-'.repeat(60) + '\n');

  process.exit(failed.length > 0 ? 1 : 0);
})();
