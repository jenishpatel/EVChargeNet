# Contributing to EV ChargeNet

First off, thank you for considering contributing to EV ChargeNet! It's people like you that make open source such a great community. We welcome any form of contribution, from reporting a bug to submitting a feature request or writing code.

This document provides a set of guidelines for contributing to the project. These are mostly guidelines, not strict rules. Use your best judgment, and feel free to propose changes to this document in a pull request.

## Code of Conduct

This project and everyone participating in it is governed by the [EV ChargeNet Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code. Please report unacceptable behavior.

*(Note: You will need to create a `CODE_OF_CONDUCT.md` file. The Contributor Covenant is a great template: [www.contributor-covenant.org](https://www.contributor-covenant.org/))*

## How Can I Contribute?

There are many ways to contribute to the project. Here are a few ideas:

* **Reporting Bugs**: If you find a bug, please let us know!
* **Suggesting Enhancements**: If you have an idea for a new feature or an improvement to an existing one.
* **Writing Code**: If you are a developer, you can help us by fixing bugs or adding new features.
* **Improving Documentation**: If you see an area where the documentation could be improved, please feel free to submit a pull request.

### Reporting Bugs

Before creating a bug report, please check the existing [issues](https://github.com/your-username/your-repo-name/issues) to see if the bug has already been reported. If it has, please add a comment to the existing issue instead of creating a new one.

When you are creating a bug report, please include as many details as possible. Fill out the required template, which will help us resolve issues faster. Please include:

* **A clear and descriptive title** for the issue.
* **Steps to reproduce the bug** in as much detail as possible.
* **What you expected to happen** and **what actually happened**.
* **Screenshots or screen recordings** which show the issue.
* **Your browser and operating system**.

### Suggesting Enhancements

If you have an idea for an enhancement, please create an issue on our [issues page](https://github.com/your-username/your-repo-name/issues). Before creating an enhancement suggestion, please check the existing issues to see if the enhancement has already been suggested.

When you are creating an enhancement suggestion, please include:

* **A clear and descriptive title** for the enhancement.
* **A step-by-step description of the suggested enhancement** in as much detail as possible.
* **Use-cases** for the enhancement.
* **Mockups or wireframes** if applicable.

## Development Setup

Ready to contribute code? Here’s how to set up `EV ChargeNet` for local development.

1.  **Fork the repository** on GitHub.
2.  **Clone your fork locally:**
    ```sh
    git clone [https://github.com/your-username/EVchargeNet.git](https://github.com/your-username/EVchargeNet.git)
    cd EVchargeNet
    ```
3.  **Set up the `config.js` file** as described in the `README.md`. You will need your own Firebase project for this.
4.  **Open `index.html`** in your browser to run the application.

## Pull Request Process

1.  Ensure any install or build dependencies are removed before the end of the layer when doing a build.
2.  Update the `README.md` with details of changes to the interface, this includes new environment variables, exposed ports, useful file locations, and container parameters.
3.  Create your pull request against the `main` branch of the original repository.
4.  Provide a clear and descriptive title for your pull request.
5.  In the pull request description, explain the changes you have made and link to the issue that your pull request resolves (e.g., "Closes #123").
6.  Ensure your code follows the project's coding style.
7.  After you submit your pull request, a project maintainer will review your changes. We may ask you to make some changes before your pull request is merged.

## Coding Style

* **JavaScript**: We use a modern JavaScript (ES6+) style.
    * Use `const` and `let` instead of `var`.
    * We value clear, readable code. Add comments where the logic is complex.
    * Functions should be well-defined and serve a single purpose.
* **HTML**: Use semantic HTML5 tags where possible.
* **CSS**: We use [TailwindCSS](https://tailwindcss.com/) for styling. Please use Tailwind utility classes whenever possible. For custom styles, add them to `style.css`.
* **Firebase**: All interactions with Firebase should be handled within the `script.js` file.
* **Git Commits**: Write clear and concise commit messages.

Thank you again for your interest in contributing to EV ChargeNet!
