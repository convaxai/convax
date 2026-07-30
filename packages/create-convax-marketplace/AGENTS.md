# create-convax-marketplace contract

This package is a thin author-facing CLI over `@convax/marketplace-kit`.

- It only scaffolds a new Marketplace and one explicitly selected starter.
- Generated repositories directly depend only on `@convax/marketplace-kit`.
- Workflows use pinned action commits, minimal permissions, no
  `pull_request_target`, and never execute authored package/companion bytes.
- The release surface must be tested from a real packed tarball.
