# DueDilly — Google Cloud & Firebase Deployment Guide

This guide details how to run DueDilly locally and deploy it to **Google Cloud (Cloud Run)** or **Firebase Hosting**.

---

## 1. Local Testing & Verification

### Prerequisites
- Node.js v20+ or v24+ (Node.js 24 is installed)
- npm

### Run Locally
```bash
# 1. Install dependencies
npm install

# 2. Run unit and integration tests (92 automated tests)
npm test

# 3. Start local development server
npm start
```
The application will launch at:
- **Web UI:** [http://localhost:8080/](http://localhost:8080/) or [http://localhost:8080/saf-globe.html](http://localhost:8080/saf-globe.html)
- **Health Check:** [http://localhost:8080/api/health](http://localhost:8080/api/health)
- **Public Screening API:** `POST http://localhost:8080/v1/screen`

The local SQLite database (`data/safe_globe.db`) initializes and auto-seeds all PRD demo data upon first boot.

---

## 2. Deploying to Google Cloud Run

Google Cloud Run runs the containerized DueDilly backend and frontend with automatic scaling (scale-to-zero when idle, scale-up on demand), HTTPS termination, and zero server maintenance.

### Step 1: Install & Initialize Google Cloud SDK (`gcloud`)
```bash
# Log in to your Google Cloud account
gcloud auth login

# Set your active GCP project ID
gcloud config set project YOUR_PROJECT_ID

# Enable required Google Cloud APIs
gcloud services enable run.googleapis.com \
                       artifactregistry.googleapis.com \
                       cloudbuild.googleapis.com
```

### Step 2: One-Command Source Deployment to Cloud Run
Google Cloud Run can build and deploy the container directly from source code using the bundled `Dockerfile`:

```bash
gcloud run deploy safe-globe-app \
  --source . \
  --region asia-southeast1 \
  --platform managed \
  --allow-unauthenticated \
  --port 8080 \
  --memory 512Mi \
  --cpu 1
```

Once deployment finishes, Google Cloud outputs the live public HTTPS service URL:
```text
Service [safe-globe-app] revision [safe-globe-app-00001-abc] has been deployed.
Service URL: https://safe-globe-app-xxxxxx-as.a.run.app
```

---

## 3. Automated CI/CD via Google Cloud Build

Use `cloudbuild.yaml` to trigger automated builds and deployments:

```bash
# 1. Create an Artifact Registry Docker repository (once)
gcloud artifacts repositories create safe-globe \
  --repository-format=docker \
  --location=asia-southeast1 \
  --description="DueDilly container images"

# 2. Submit the build to Cloud Build
gcloud builds submit --config=cloudbuild.yaml
```

---

## 4. Deploying via Firebase Hosting

Firebase Hosting provides global CDN edge caching for the frontend (`saf-globe.html`) and forwards dynamic API requests (`/api/**` and `/v1/**`) directly to the Cloud Run service.

### Step 1: Install Firebase CLI
```bash
npm install -g firebase-tools
```

### Step 2: Log In & Connect Project
```bash
firebase login
firebase use YOUR_PROJECT_ID
```

### Step 3: Deploy to Firebase Hosting
```bash
firebase deploy --only hosting
```

Your app will be accessible at:
```text
https://YOUR_PROJECT_ID.web.app
https://YOUR_PROJECT_ID.firebaseapp.com
```

---

## 5. Transitioning from Local SQLite to Cloud Production DB

For initial deployment and testing, the application uses local SQLite (`data/safe_globe.db`). For high-availability multi-instance Cloud Run production environments:

### Option A: Google Cloud SQL (PostgreSQL / MySQL)
1. Provision a Cloud SQL Postgres instance in GCP:
   ```bash
   gcloud sql instances create safe-globe-db --database-version=POSTGRES_15 --tier=db-f1-micro --region=asia-southeast1
   ```
2. Set the `DATABASE_URL` environment variable in Cloud Run:
   ```bash
   gcloud run services update safe-globe-app \
     --set-env-vars DATABASE_TYPE=postgres,DATABASE_URL="postgresql://user:pass@/dbname?host=/cloudsql/PROJECT:REGION:INSTANCE" \
     --add-cloudsql-instances PROJECT:REGION:INSTANCE
   ```

### Option B: Google Cloud Firestore / Firebase Database
1. Enable Cloud Firestore in Native mode in the GCP Console.
2. In Cloud Run, set `DATABASE_TYPE=firestore` and grant the Cloud Run service account the `roles/datastore.user` IAM role. The database abstraction layer in `src/db/index.js` automatically routes database calls to Firestore.
