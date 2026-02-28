/**
 * ARIES Autopilot — Autonomous Business Builder
 * Decomposes a business goal into phases, assigns agents, tracks milestones.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'autopilot');

const PHASES = [
  { id: 'research',    name: 'Research',    icon: '🔍', description: 'Market analysis, competitor research' },
  { id: 'planning',    name: 'Planning',    icon: '📋', description: 'Architecture, tech stack, feature list' },
  { id: 'development', name: 'Development', icon: '⌨️', description: 'Code generation via Aries Code' },
  { id: 'testing',     name: 'Testing',     icon: '🧪', description: 'Automated testing, bug fixes' },
  { id: 'deployment',  name: 'Deployment',  icon: '🚀', description: 'Server setup, domain, launch' },
  { id: 'marketing',   name: 'Marketing',   icon: '📢', description: 'Landing page, social posts, launch strategy' },
  { id: 'operations',  name: 'Operations',  icon: '⚙️', description: 'Monitoring, user feedback, iteration' }
];

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadProject(id) {
  const fp = path.join(DATA_DIR, id + '.json');
  if (!fs.existsSync(fp)) return null;
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return null; }
}

function saveProject(project) {
  ensureDir();
  fs.writeFileSync(path.join(DATA_DIR, project.id + '.json'), JSON.stringify(project, null, 2));
}

function listProjects() {
  ensureDir();
  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
  return files.map(f => {
    try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8')); } catch { return null; }
  }).filter(Boolean).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

function createProject(goal, budget, timeline) {
  const id = 'ap-' + crypto.randomBytes(6).toString('hex');
  const now = Date.now();
  const project = {
    id,
    goal,
    budget: budget || null,
    timeline: timeline || null,
    status: 'active',       // active | paused | completed | cancelled
    currentPhase: 'research',
    createdAt: now,
    updatedAt: now,
    phases: PHASES.map(p => ({
      id: p.id,
      name: p.name,
      icon: p.icon,
      description: p.description,
      status: p.id === 'research' ? 'active' : 'pending',  // pending | active | review | approved | complete
      startedAt: p.id === 'research' ? now : null,
      completedAt: null,
      estimatedCost: 0,
      actualCost: 0,
      deliverables: [],
      agents: [],
      milestones: [],
      feedback: []
    })),
    log: [{ ts: now, event: 'created', message: 'Project created: ' + goal }],
    totalCost: 0
  };
  saveProject(project);
  return project;
}

function getPhaseIndex(project, phaseId) {
  return project.phases.findIndex(p => p.id === phaseId);
}

function approvePhase(project, phaseId) {
  const idx = getPhaseIndex(project, phaseId);
  if (idx === -1) return { error: 'Phase not found' };
  const phase = project.phases[idx];
  if (phase.status !== 'review' && phase.status !== 'active') {
    return { error: 'Phase is not awaiting approval (status: ' + phase.status + ')' };
  }
  phase.status = 'complete';
  phase.completedAt = Date.now();
  project.log.push({ ts: Date.now(), event: 'approved', phase: phaseId, message: 'Phase "' + phase.name + '" approved' });

  // Advance to next phase
  if (idx + 1 < project.phases.length) {
    const next = project.phases[idx + 1];
    next.status = 'active';
    next.startedAt = Date.now();
    project.currentPhase = next.id;
    project.log.push({ ts: Date.now(), event: 'phase-start', phase: next.id, message: 'Phase "' + next.name + '" started' });
  } else {
    project.status = 'completed';
    project.log.push({ ts: Date.now(), event: 'completed', message: 'All phases complete! Project finished.' });
  }
  project.updatedAt = Date.now();
  saveProject(project);
  return project;
}

function addFeedback(project, phaseId, feedback) {
  const idx = getPhaseIndex(project, phaseId);
  if (idx === -1) return { error: 'Phase not found' };
  const phase = project.phases[idx];
  phase.feedback.push({ ts: Date.now(), text: feedback });
  if (phase.status === 'review') phase.status = 'active'; // back to active for rework
  project.log.push({ ts: Date.now(), event: 'feedback', phase: phaseId, message: 'Feedback on "' + phase.name + '": ' + feedback });
  project.updatedAt = Date.now();
  saveProject(project);
  return project;
}

function pauseProject(project) {
  project.status = 'paused';
  project.log.push({ ts: Date.now(), event: 'paused', message: 'Project paused' });
  project.updatedAt = Date.now();
  saveProject(project);
  return project;
}

function resumeProject(project) {
  project.status = 'active';
  project.log.push({ ts: Date.now(), event: 'resumed', message: 'Project resumed' });
  project.updatedAt = Date.now();
  saveProject(project);
  return project;
}

function cancelProject(project) {
  project.status = 'cancelled';
  project.log.push({ ts: Date.now(), event: 'cancelled', message: 'Project cancelled' });
  project.updatedAt = Date.now();
  saveProject(project);
  return project;
}

function addDeliverable(projectId, phaseId, deliverable) {
  const project = loadProject(projectId);
  if (!project) return null;
  const idx = getPhaseIndex(project, phaseId);
  if (idx === -1) return null;
  project.phases[idx].deliverables.push({
    ts: Date.now(),
    name: deliverable.name || 'Untitled',
    type: deliverable.type || 'file',
    path: deliverable.path || '',
    description: deliverable.description || ''
  });
  project.log.push({ ts: Date.now(), event: 'deliverable', phase: phaseId, message: 'Deliverable added: ' + (deliverable.name || 'Untitled') });
  project.updatedAt = Date.now();
  saveProject(project);
  return project;
}

function markPhaseReview(projectId, phaseId) {
  const project = loadProject(projectId);
  if (!project) return null;
  const idx = getPhaseIndex(project, phaseId);
  if (idx === -1) return null;
  project.phases[idx].status = 'review';
  project.log.push({ ts: Date.now(), event: 'review', phase: phaseId, message: 'Phase "' + project.phases[idx].name + '" ready for review' });
  project.updatedAt = Date.now();
  saveProject(project);
  return project;
}

// Generate a plan using AI
async function generatePlan(goal, aiModule) {
  if (!aiModule || !aiModule.chat) return null;
  const prompt = `You are a business planning AI. Given the following business goal, create a detailed project plan.

Goal: ${goal}

For each of these 7 phases, provide:
1. Key milestones (2-3 per phase)
2. Estimated duration
3. Key deliverables

Phases: Research, Planning, Development, Testing, Deployment, Marketing, Operations

Respond in JSON format:
{
  "phases": [
    { "id": "research", "milestones": ["..."], "duration": "X days", "deliverables": ["..."] },
    ...
  ]
}`;

  try {
    const result = await aiModule.chat([{ role: 'user', content: prompt }], { model: 'auto' });
    const text = result.text || result.content || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.error('[AUTOPILOT] Plan generation error:', e.message);
  }
  return null;
}

module.exports = {
  PHASES,
  createProject,
  loadProject,
  saveProject,
  listProjects,
  approvePhase,
  addFeedback,
  pauseProject,
  resumeProject,
  cancelProject,
  addDeliverable,
  markPhaseReview,
  generatePlan
};
