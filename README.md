# CA_Dashboard

A dashboard for monitoring multiple coding agent sessions (Claude Code, CodeX, etc.) running simultaneously, especially on remote servers via SSH and tmux.

## Problem

When working with coding agents like Claude Code and CodeX, it's common to run multiple sessions in parallel to handle many tasks at once. This creates a visibility problem:

- Which sessions are actively executing?
- Which sessions are paused and waiting for user input?
- Which sessions just finished their last task?
- Which sessions are hanging?

Checking each session individually — especially when they're on a remote server — is tedious and error-prone.

## Solution

CA_Dashboard provides a unified view of all your coding agent sessions, showing real-time status for each one so you can quickly see what needs attention.

## Features (planned)

- Real-time session status monitoring
- Support for SSH + tmux remote sessions
- Detection of session states: executing, waiting for input, idle/finished, hanging
- Clean dashboard UI

## Getting Started

_Setup instructions coming soon._
