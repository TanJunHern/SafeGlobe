/**
 * Spend cap: removes the billing account from the project when the budget's cost passes its amount.
 * Triggered by the budget's Pub/Sub notifications. Adapted from Google's documented example
 * (docs.cloud.google.com/billing/docs/how-to/disable-billing-with-notifications, Apache 2.0).
 *
 * WARNING: with billing removed, every service in the project stops, including the DueDilly link,
 * and resources may be deleted. It is not undone by itself.
 */
const { CloudBillingClient } = require('@google-cloud/billing');

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT;
const PROJECT_NAME = `projects/${PROJECT_ID}`;
const billing = new CloudBillingClient();

exports.stopBilling = async pubsubEvent => {
  const pubsubData = JSON.parse(Buffer.from(pubsubEvent.data, 'base64').toString());
  if (pubsubData.costAmount <= pubsubData.budgetAmount) {
    return `No action necessary. (Current cost: ${pubsubData.costAmount})`;
  }
  if (!PROJECT_ID) return 'No project specified';

  const billingEnabled = await isBillingEnabled(PROJECT_NAME);
  if (!billingEnabled) return 'Billing already disabled';
  const [res] = await billing.updateProjectBillingInfo({
    name: PROJECT_NAME,
    resource: { billingAccountName: '' } // Disable billing
  });
  console.log(`Budget exceeded (${pubsubData.costAmount} > ${pubsubData.budgetAmount}). Billing disabled on ${PROJECT_ID}.`);
  return `Billing disabled: ${JSON.stringify(res)}`;
};

async function isBillingEnabled(projectName) {
  try {
    const [res] = await billing.getProjectBillingInfo({ name: projectName });
    return res.billingEnabled;
  } catch (e) {
    console.log('Unable to determine if billing is enabled on the project, assuming it is');
    return true;
  }
}
