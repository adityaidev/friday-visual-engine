# CI Setup

The `ci.yml.example` in this folder is the GitHub Actions workflow we recommend.

**Why it isn't already installed:** the default `gh` CLI OAuth scope doesn't include `workflow`, so the first automated push couldn't include anything under `.github/workflows/`. Moving it in is a one-time manual step.

## To activate CI

Run once:

```bash
gh auth refresh -s workflow

# then:
mkdir -p .github/workflows
cp docs/ci/ci.yml.example .github/workflows/ci.yml
git add .github/workflows/ci.yml
git commit -m "ci: add GitHub Actions workflow"
git push
```

From that point on, every push to `main` and every PR runs typecheck + tests + build on Node 22.
