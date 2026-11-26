import assert from "node:assert/strict";
import test from "node:test";
import { profileConfiguration, profileMode, toolProjection, ToolProfile } from "../extensions/claude-native-tools/profile.ts";

test("profile auto/off/force and optional matcher support aliases with fail-closed invalid configuration", () => {
	const defaultConfig = profileConfiguration(undefined, undefined);
	assert.equal(profileMode(defaultConfig.setting, "claude-sonnet", defaultConfig.matcher), "claude");
	assert.equal(profileMode("off", "claude-sonnet", defaultConfig.matcher), "pi");
	assert.equal(profileMode("force", "my-model", undefined), "claude");
	assert.equal(profileMode("force", undefined, undefined), "claude");
	const alias = profileConfiguration("auto", "^proxy-(sonnet|opus)$");
	assert.equal(profileMode(alias.setting, "PROXY-OPUS", alias.matcher), "claude");
	const invalid = profileConfiguration("auto", "[");
	assert.equal(profileMode(invalid.setting, "claude", invalid.matcher), "pi");
	assert.equal(invalid.issues.length, 1);
	assert.equal(profileConfiguration("typo", undefined).setting, "off");
});

test("profile switches tool pairs without activating omitted tools", () => {
	const profile = new ToolProfile();
	let active = profile.sync(["read", "find", "custom"], "claude", false);
	assert.deepEqual(active, ["read", "Read", "find", "Glob", "custom"]);
	active = profile.sync(active, "pi", false);
	assert.deepEqual(active, ["read", "find", "custom"]);
	assert.deepEqual(profile.sync(active, "claude", false), ["read", "Read", "find", "Glob", "custom"]);
	assert.deepEqual(new ToolProfile().sync([], "claude", false), []);
});

test("removing either side disables the pair across future profile changes", () => {
	for (const removed of ["read", "Read"]) {
		const profile = new ToolProfile();
		let active = profile.sync(["read", "find"], "claude", false);
		active = profile.sync(active.filter((name) => name !== removed), "claude", false);
		assert.deepEqual(active, ["find", "Glob"]);
		active = profile.sync(active, "pi", false);
		active = profile.sync(active, "claude", false);
		assert.deepEqual(active, ["find", "Glob"]);
		assert.deepEqual(profile.sync([...active, "read"], "claude", false), ["find", "Glob", "read", "Read"]);
	}
});

test("host alias filtering preserves the native tool on subsequent turns", () => {
	const profile = new ToolProfile();
	profile.sync(["read"], "claude", false);
	profile.accept(["read"]);
	assert.deepEqual(profile.sync(["read"], "claude", false), ["read", "Read"]);
	profile.accept(["read"]);
	assert.deepEqual(profile.sync(["read"], "pi", false), ["read"]);
});

test("background task controls survive profile off and respect explicit removals", () => {
	const profile = new ToolProfile();
	let active = profile.sync(["bash"], "claude", false);
	assert.deepEqual(active, ["bash", "Bash", "TaskOutput", "TaskStop"]);
	active = profile.sync(active, "pi", true);
	assert.deepEqual(active, ["bash", "TaskOutput", "TaskStop"]);
	active = profile.sync(active.filter((name) => name !== "TaskStop"), "pi", true);
	assert.deepEqual(active, ["bash", "TaskOutput"]);
});

test("effective projection distinguishes native-only, mixed, and complete Claude profiles", () => {
	const nativeOnly = toolProjection("claude", ["read"]);
	assert.equal(nativeOnly.effective, "pi");
	assert.deepEqual([...nativeOnly.claudeAliases], []);
	assert.deepEqual(nativeOnly.nativeTools, ["read"]);
	const mixed = toolProjection("claude", ["read", "write", "Write"]);
	assert.equal(mixed.effective, "partial");
	assert.deepEqual([...mixed.claudeAliases], ["Write"]);
	assert.deepEqual(mixed.nativeTools, ["read"]);
	assert.equal(toolProjection("claude", ["read", "Read"]).effective, "claude");
	assert.equal(toolProjection("pi", ["read"]).effective, "pi");
	assert.equal(toolProjection("claude", []).effective, "pi");
});
