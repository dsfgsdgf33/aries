/**
 * ARES Trainer — Local Training Engine
 * Generates training scripts and manages fine-tuning.
 * Wraps QLoRA training for local or remote execution.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const TRAINING_DATA_DIR = path.join(DATA_DIR, 'ares-training-data');
const SCRIPTS_DIR = path.join(DATA_DIR, 'ares-scripts');
const ADAPTERS_DIR = path.join(DATA_DIR, 'ares-adapters');

class AresTrainer {
  constructor(config) {
    this.config = Object.assign({
      baseModel: 'dolphin-2.9-llama3.1-70b',
      method: 'qlora',
      loraRank: 64,
      loraAlpha: 16,
      learningRate: 2e-4,
      lrScheduler: 'cosine',
      batchSize: 4,
      gradientAccumulation: 16,
      epochsPerCycle: 3,
      maxSeqLength: 4096,
      quantBits: 4,
      warmupSteps: 100,
      saveSteps: 500,
      evalSteps: 250,
      outputDir: ADAPTERS_DIR,
      autoExecute: false, // Set true when home server is ready
    }, config || {});

    this._process = null;
    this._progress = { status: 'idle', step: 0, totalSteps: 0, loss: null, eta: null };
  }

  async prepareDataset(cycle) {
    var cycleDir = path.join(TRAINING_DATA_DIR, 'cycle-' + cycle);
    if (!fs.existsSync(cycleDir)) {
      return { status: 'error', reason: 'No training data for cycle ' + cycle };
    }

    // Merge all JSON files into a single training dataset
    var allExamples = [];
    var files = fs.readdirSync(cycleDir).filter(function(f) { return f.endsWith('.json'); });
    for (var i = 0; i < files.length; i++) {
      try {
        var data = JSON.parse(fs.readFileSync(path.join(cycleDir, files[i]), 'utf8'));
        if (Array.isArray(data)) allExamples = allExamples.concat(data);
      } catch (e) {
        console.error('[ARES-TRAINER] Error reading ' + files[i] + ':', e.message);
      }
    }

    if (allExamples.length === 0) {
      return { status: 'error', reason: 'No valid examples found' };
    }

    // Convert to ChatML format for training
    var chatML = allExamples.map(function(ex) {
      return {
        messages: [
          { role: 'user', content: ex.input ? ex.instruction + '\n\n' + ex.input : ex.instruction },
          { role: 'assistant', content: ex.output },
        ],
      };
    });

    // Split train/eval (90/10)
    var splitIdx = Math.floor(chatML.length * 0.9);
    var trainSet = chatML.slice(0, splitIdx);
    var evalSet = chatML.slice(splitIdx);

    // Write datasets
    var outDir = path.join(DATA_DIR, 'ares-datasets', 'cycle-' + cycle);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    // Write as JSONL (one JSON per line)
    var trainPath = path.join(outDir, 'train.jsonl');
    var evalPath = path.join(outDir, 'eval.jsonl');
    fs.writeFileSync(trainPath, trainSet.map(function(x) { return JSON.stringify(x); }).join('\n'));
    fs.writeFileSync(evalPath, evalSet.map(function(x) { return JSON.stringify(x); }).join('\n'));

    return {
      status: 'ok',
      trainExamples: trainSet.length,
      evalExamples: evalSet.length,
      trainPath: trainPath,
      evalPath: evalPath,
    };
  }

  generateTrainingScript(opts) {
    opts = Object.assign({}, this.config, opts || {});
    if (!fs.existsSync(SCRIPTS_DIR)) fs.mkdirSync(SCRIPTS_DIR, { recursive: true });

    var cycle = opts.cycle || 0;
    var datasetDir = path.join(DATA_DIR, 'ares-datasets', 'cycle-' + cycle);
    var outputDir = path.join(ADAPTERS_DIR, 'cycle-' + cycle);

    // Determine LoRA rank based on cycle
    var rank = opts.loraRank;
    if (cycle > 50) rank = 256;
    else if (cycle > 10) rank = 128;

    var script = '#!/bin/bash\n';
    script += '# ARES Training Script — Cycle ' + cycle + '\n';
    script += '# Generated: ' + new Date().toISOString() + '\n';
    script += '# Base Model: ' + opts.baseModel + '\n';
    script += '# Method: QLoRA (' + opts.quantBits + '-bit)\n';
    script += '# LoRA Rank: ' + rank + '\n\n';
    script += 'set -e\n\n';
    script += '# Activate training environment\n';
    script += '# conda activate ares-train  # uncomment when env is set up\n\n';
    script += 'python -m transformers.trainer \\\n';
    script += '  --model_name_or_path "' + opts.baseModel + '" \\\n';
    script += '  --dataset_name "' + datasetDir + '" \\\n';
    script += '  --train_file "' + path.join(datasetDir, 'train.jsonl') + '" \\\n';
    script += '  --validation_file "' + path.join(datasetDir, 'eval.jsonl') + '" \\\n';
    script += '  --output_dir "' + outputDir + '" \\\n';
    script += '  --num_train_epochs ' + opts.epochsPerCycle + ' \\\n';
    script += '  --per_device_train_batch_size ' + opts.batchSize + ' \\\n';
    script += '  --gradient_accumulation_steps ' + opts.gradientAccumulation + ' \\\n';
    script += '  --learning_rate ' + opts.learningRate + ' \\\n';
    script += '  --lr_scheduler_type ' + opts.lrScheduler + ' \\\n';
    script += '  --warmup_steps ' + opts.warmupSteps + ' \\\n';
    script += '  --max_seq_length ' + opts.maxSeqLength + ' \\\n';
    script += '  --save_steps ' + opts.saveSteps + ' \\\n';
    script += '  --eval_steps ' + opts.evalSteps + ' \\\n';
    script += '  --logging_steps 10 \\\n';
    script += '  --bf16 \\\n';
    script += '  --use_peft \\\n';
    script += '  --lora_r ' + rank + ' \\\n';
    script += '  --lora_alpha ' + (rank * 2) + ' \\\n';
    script += '  --lora_dropout 0.05 \\\n';
    script += '  --bits ' + opts.quantBits + ' \\\n';
    script += '  --double_quant \\\n';
    script += '  --quant_type nf4 \\\n';
    script += '  --report_to none\n\n';
    script += 'echo "Training complete for cycle ' + cycle + '"\n';
    script += 'echo "Adapter saved to: ' + outputDir + '"\n';

    var scriptPath = path.join(SCRIPTS_DIR, 'train-cycle-' + cycle + '.sh');
    fs.writeFileSync(scriptPath, script);

    // Also generate a Windows batch version
    var bat = '@echo off\n';
    bat += 'REM ARES Training Script — Cycle ' + cycle + '\n';
    bat += 'REM Generated: ' + new Date().toISOString() + '\n\n';
    bat += 'python -m transformers.trainer ^\n';
    bat += '  --model_name_or_path "' + opts.baseModel + '" ^\n';
    bat += '  --train_file "' + path.join(datasetDir, 'train.jsonl') + '" ^\n';
    bat += '  --output_dir "' + outputDir + '" ^\n';
    bat += '  --num_train_epochs ' + opts.epochsPerCycle + ' ^\n';
    bat += '  --per_device_train_batch_size ' + opts.batchSize + ' ^\n';
    bat += '  --gradient_accumulation_steps ' + opts.gradientAccumulation + ' ^\n';
    bat += '  --learning_rate ' + opts.learningRate + ' ^\n';
    bat += '  --use_peft ^\n';
    bat += '  --lora_r ' + rank + ' ^\n';
    bat += '  --bits ' + opts.quantBits + '\n';

    var batPath = path.join(SCRIPTS_DIR, 'train-cycle-' + cycle + '.bat');
    fs.writeFileSync(batPath, bat);

    return {
      status: 'ok',
      scriptPath: scriptPath,
      batPath: batPath,
      rank: rank,
      cycle: cycle,
    };
  }

  async startTraining(cycle) {
    if (this._process) return { status: 'error', reason: 'Training already in progress' };

    // Generate the script first
    var script = this.generateTrainingScript({ cycle: cycle });

    if (!this.config.autoExecute) {
      return {
        status: 'script_ready',
        message: 'Training script generated. Execute manually when home server is ready.',
        scriptPath: script.scriptPath,
        batPath: script.batPath,
      };
    }

    // Auto-execute mode
    var self = this;
    return new Promise(function(resolve, reject) {
      self._progress = { status: 'running', step: 0, totalSteps: 0, loss: null, eta: null, started: Date.now() };

      var proc = spawn('bash', [script.scriptPath], {
        cwd: path.join(__dirname, '..', '..'),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      self._process = proc;

      var output = '';
      proc.stdout.on('data', function(data) {
        output += data.toString();
        // Parse training progress from output
        var lines = data.toString().split('\n');
        for (var i = 0; i < lines.length; i++) {
          var stepMatch = lines[i].match(/Step (\d+)\/(\d+)/);
          if (stepMatch) {
            self._progress.step = parseInt(stepMatch[1]);
            self._progress.totalSteps = parseInt(stepMatch[2]);
          }
          var lossMatch = lines[i].match(/loss[:\s]+([\d.]+)/i);
          if (lossMatch) self._progress.loss = parseFloat(lossMatch[1]);
        }
      });

      proc.stderr.on('data', function(data) { output += data.toString(); });

      proc.on('close', function(code) {
        self._process = null;
        self._progress.status = code === 0 ? 'complete' : 'error';
        resolve({
          status: code === 0 ? 'ok' : 'error',
          exitCode: code,
          cycle: cycle,
          output: output.slice(-2000), // last 2KB
        });
      });

      proc.on('error', function(err) {
        self._process = null;
        self._progress.status = 'error';
        resolve({ status: 'error', reason: err.message });
      });
    });
  }

  getTrainingProgress() {
    return Object.assign({}, this._progress);
  }

  async mergeAdapter(adapterPath) {
    // Generate merge script
    if (!fs.existsSync(SCRIPTS_DIR)) fs.mkdirSync(SCRIPTS_DIR, { recursive: true });

    var script = '#!/bin/bash\n';
    script += '# ARES Adapter Merge Script\n';
    script += 'python -c "\n';
    script += 'from peft import PeftModel\n';
    script += 'from transformers import AutoModelForCausalLM, AutoTokenizer\n';
    script += 'model = AutoModelForCausalLM.from_pretrained(\\"' + this.config.baseModel + '\\")\n';
    script += 'model = PeftModel.from_pretrained(model, \\"' + adapterPath + '\\")\n';
    script += 'model = model.merge_and_unload()\n';
    script += 'model.save_pretrained(\\"' + adapterPath + '-merged\\")\n';
    script += '"\n';

    var scriptPath = path.join(SCRIPTS_DIR, 'merge-' + path.basename(adapterPath) + '.sh');
    fs.writeFileSync(scriptPath, script);

    return { status: 'script_ready', scriptPath: scriptPath };
  }

  async evaluateModel(cycle) {
    // Generate evaluation tasks and score
    var evalPath = path.join(DATA_DIR, 'ares-datasets', 'cycle-' + cycle, 'eval.jsonl');
    if (!fs.existsSync(evalPath)) {
      return { status: 'no_eval_data', score: null };
    }

    var lines = fs.readFileSync(evalPath, 'utf8').trim().split('\n');
    return {
      status: 'eval_ready',
      evalExamples: lines.length,
      cycle: cycle,
      message: 'Evaluation dataset ready. Run eval when model is trained.',
      // Placeholder scores — filled in after actual eval
      scores: {
        reasoning: null,
        code: null,
        creative: null,
        instruction_following: null,
        overall: null,
      },
    };
  }
}

module.exports = { AresTrainer };
