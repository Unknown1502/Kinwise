#!/usr/bin/env node
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { App, Tags } from 'aws-cdk-lib';
import { KinwiseStack } from '../lib/kinwise-stack.js';

const app = new App();
const ctx = (key: string, fallback: string) => (app.node.tryGetContext(key) as string | undefined) ?? fallback;
const list = (key: string, fallback: string) => ctx(key, fallback).split(',').map((s) => s.trim()).filter(Boolean);

const account = process.env.CDK_DEFAULT_ACCOUNT;
const region = process.env.CDK_DEFAULT_REGION ?? 'us-east-1';

const stack = new KinwiseStack(app, 'Kinwise', {
  env: { account, region },
  description: 'Kinwise: consent-first family safety net (Amazon AppDev 2026)',
  repoRoot: resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'),
  authDomainPrefix: ctx('authDomainPrefix', `kinwise-${account ?? 'demo'}`),
  callbackUrls: list('callbackUrls', 'http://localhost:5173/callback'),
  allowedOrigins: list('allowedOrigins', 'http://localhost:5173,http://localhost:5174'),
  caregiverEmail: app.node.tryGetContext('caregiverEmail') as string | undefined,
  conciergeModelId: ctx('conciergeModelId', 'us.amazon.nova-2-lite-v1:0'),
  demoTimezone: ctx('demoTimezone', 'America/New_York'),
  devRoutes: ctx('devRoutes', 'true') === 'true',
});

Tags.of(stack).add('project', 'kinwise');
Tags.of(stack).add('hackathon', 'amazon-appdev-2026');
