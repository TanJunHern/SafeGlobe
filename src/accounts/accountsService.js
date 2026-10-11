/**
 * Account rules: who may join a workspace, how an invitation is accepted, and what a compliance officer may change.
 * Every change is written to the account log (who, what, when). Errors carry an HTTP status and a plain message.
 */
const { getAccountsStore, normEmail, DEMO_WORKSPACE_ID, DEMO_ACCOUNTS } = require('./accountsStore');

const ROLES = { compliance_officer: 'Compliance officer', employee: 'Employee' };
const NO_ACCESS = "You don't have access yet. Ask your compliance officer to invite you, or create your own workspace.";
const LAST_OFFICER = 'A workspace must always have at least one compliance officer. Make someone else a compliance officer first.';
const NOT_IN_DEMO = 'Not available in the demo';

function fail(status, message, code) {
  const err = new Error(message);
  err.status = status;
  if (code) err.code = code;
  return err;
}

const validEmail = email => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 200;
const clean = (value, max = 100) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);

/** What the pages may know about an account. */
function publicAccount(a) {
  return {
    id: a.id, name: a.name, email: a.email, role: a.role, roleLabel: ROLES[a.role] || a.role,
    status: a.status, statusLabel: a.status === 'invited' ? 'Invited' : 'Active',
    isDemo: Boolean(a.is_demo), invitedAt: a.invited_at || null, lastSignInAt: a.last_sign_in_at || null
  };
}

/** The signed-in user as the app has always described one, plus the account and workspace. */
function userFor(account) {
  const store = getAccountsStore();
  const workspace = store.getWorkspace(account.workspace_id);
  return {
    email: account.email,
    name: account.name || account.email,
    userId: account.id,
    department: account.department || (workspace ? workspace.name : ''),
    role: account.role,
    anonymous: false,
    accountId: account.id,
    demoAccount: Boolean(account.is_demo),
    workspace: workspace ? { id: workspace.id, name: workspace.name, isDemo: workspace.isDemo } : null
  };
}

function demoAccount(keyOrEmail) {
  const wanted = String(keyOrEmail || '').toLowerCase().trim();
  const known = DEMO_ACCOUNTS.find(a => a.key === wanted || a.email === wanted);
  const account = known ? getAccountsStore().getAccountById(known.id) : null;
  return account && account.is_demo ? account : null;
}

function recordSignIn(account) {
  return getAccountsStore().updateAccount(account.id, { last_sign_in_at: new Date().toISOString() });
}

/**
 * A verified Google sign-in. Active account: signed in. Invited account: the invitation is accepted.
 * Anyone else is refused, and no account is created.
 */
function signInWithGoogle({ email, name }) {
  const store = getAccountsStore();
  let account = store.getAccountByEmail(email);
  if (!account) throw fail(403, NO_ACCESS, 'no_access');
  if (account.status === 'invited') {
    account = store.updateAccount(account.id, { status: 'active', name: clean(name) || account.name || account.email });
    store.addAudit({ workspace_id: account.workspace_id, actor: account, action: 'Invitation accepted', target: account, detail: 'Signed in with Google using the invited email.' });
  }
  return recordSignIn(account);
}

/** "Create an account": a new, empty workspace whose first compliance officer is the person signing up. */
function createWorkspace({ email, name, organisation }) {
  const store = getAccountsStore();
  const personName = clean(name);
  const orgName = clean(organisation);
  if (!personName) throw fail(400, 'Please enter your name.');
  if (!orgName) throw fail(400, 'Please enter your organisation name.');
  const existing = store.getAccountByEmail(email);
  if (existing) {
    throw fail(409, existing.status === 'invited'
      ? 'This email already has an invitation to a workspace. Use "Sign in with Google" to accept it.'
      : 'This email already has an account. Use "Sign in with Google" instead.', 'already_registered');
  }
  const workspace = store.insertWorkspace({ name: orgName, created_by: normEmail(email) });
  const account = store.insertAccount({ workspace_id: workspace.id, email, name: personName, role: 'compliance_officer', status: 'active' });
  store.addAudit({ workspace_id: workspace.id, actor: account, action: 'Workspace created', target: account, detail: `${orgName}. ${personName} is its first compliance officer.` });
  return recordSignIn(account);
}

function listForWorkspace(workspaceId) {
  const store = getAccountsStore();
  return {
    workspace: store.getWorkspace(workspaceId),
    accounts: store.listAccounts(workspaceId).map(publicAccount),
    log: store.listAudit(workspaceId).map(r => ({ id: r.id, at: r.at, actorName: r.actor_name, actorEmail: r.actor_email, action: r.action, targetName: r.target_name, targetEmail: r.target_email, detail: r.detail }))
  };
}

/** The account with that id, only if it is in the actor's own workspace. */
function ownAccount(actor, id) {
  const account = getAccountsStore().getAccountById(id);
  if (!account || account.workspace_id !== actor.workspace.id) throw fail(404, 'No account with that id in this workspace.');
  return account;
}

/**
 * How an invitation reaches the person. The Gmail path (feature 16, Phase 5) plugs in here.
 * Until then nothing is sent and the Settings tab shows "Copy invite link".
 */
async function deliverInvite(account, link) {
  return { sent: false, reason: 'Email is not connected yet. Copy the invite link and send it yourself.', link };
}

async function invite(actor, emailInput, link) {
  const store = getAccountsStore();
  const email = normEmail(emailInput);
  if (!validEmail(email)) throw fail(400, 'Please enter a valid email address.');
  const existing = store.getAccountByEmail(email);
  if (existing) {
    throw fail(409, existing.workspace_id === actor.workspace.id
      ? (existing.status === 'invited' ? 'That person has already been invited.' : 'That person already has an account here.')
      : 'That email already belongs to another workspace. One email can only be in one workspace.');
  }
  const account = store.insertAccount({
    workspace_id: actor.workspace.id, email, name: '', role: 'employee', status: 'invited',
    invited_by: actor.email, invited_at: new Date().toISOString()
  });
  const delivery = await deliverInvite(account, link);
  store.addAudit({ workspace_id: actor.workspace.id, actor, action: 'Invited', target: account, detail: `As Employee. ${delivery.sent ? 'Email sent.' : 'Email not sent; invite link shown to copy.'}` });
  return { account: publicAccount(account), delivery };
}

async function resendInvite(actor, id, link) {
  const store = getAccountsStore();
  const account = ownAccount(actor, id);
  if (account.status !== 'invited') throw fail(400, 'That person has already accepted the invitation.');
  store.updateAccount(account.id, { invited_at: new Date().toISOString(), invited_by: actor.email });
  const delivery = await deliverInvite(account, link);
  store.addAudit({ workspace_id: actor.workspace.id, actor, action: 'Invitation resent', target: account, detail: delivery.sent ? 'Email sent.' : 'Email not sent; invite link shown to copy.' });
  return { account: publicAccount(store.getAccountById(account.id)), delivery };
}

function cancelInvite(actor, id) {
  const store = getAccountsStore();
  const account = ownAccount(actor, id);
  if (account.status !== 'invited') throw fail(400, 'That person has already accepted the invitation. Delete the account instead.');
  store.deleteAccount(account.id);
  store.addAudit({ workspace_id: actor.workspace.id, actor, action: 'Invitation cancelled', target: account });
  return { cancelled: true };
}

function setRole(actor, id, role) {
  const store = getAccountsStore();
  if (!ROLES[role]) throw fail(400, 'The role must be Compliance officer or Employee.');
  const account = ownAccount(actor, id);
  if (account.status !== 'active') throw fail(400, 'The role can be changed after the person has accepted the invitation.');
  if (account.role === role) return publicAccount(account);
  if (account.role === 'compliance_officer' && store.countActiveOfficers(account.workspace_id) <= 1) throw fail(409, LAST_OFFICER, 'last_officer');
  const updated = store.updateAccount(account.id, { role });
  store.addAudit({ workspace_id: actor.workspace.id, actor, action: 'Role changed', target: account, detail: `${ROLES[account.role]} to ${ROLES[role]}.` });
  return publicAccount(updated);
}

/** Removes the person's access. The account log and all their past actions keep their name. */
function deleteAccount(actor, id) {
  const store = getAccountsStore();
  if (actor.workspace.isDemo) throw fail(403, NOT_IN_DEMO, 'not_in_demo');
  const account = ownAccount(actor, id);
  if (account.role === 'compliance_officer' && account.status === 'active' && store.countActiveOfficers(account.workspace_id) <= 1) throw fail(409, LAST_OFFICER, 'last_officer');
  store.deleteAccount(account.id);
  store.addAudit({ workspace_id: actor.workspace.id, actor, action: 'Account deleted', target: account, detail: `${ROLES[account.role]}. Access removed; past actions stay in the records under this name.` });
  return { deleted: true };
}

module.exports = {
  ROLES, NO_ACCESS, LAST_OFFICER, NOT_IN_DEMO, DEMO_WORKSPACE_ID,
  publicAccount, userFor, demoAccount, signInWithGoogle, createWorkspace, listForWorkspace,
  invite, resendInvite, cancelInvite, setRole, deleteAccount, deliverInvite
};
