import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";
import { Fieldset } from "primereact/fieldset";
import { InputSwitch } from "primereact/inputswitch";
import { InputText } from "primereact/inputtext";
import { Message } from "primereact/message";
import { Password } from "primereact/password";
import type React from "react";
import { useState } from "react";
import type { TagConfig } from "../utils/configStore";
import { RemoteConfigSchema, useConfigStore } from "../utils/configStore";
import { TagSettings } from "./TagSettings";
import "./SettingsDialog.css";

export interface SettingsDialogProps {
  visible: boolean;
  onHide: () => void;
  jsonConfig: string;
  onConfigChange: (config: string) => void;
  configError: string | null;
  onConfigError: (error: string | null) => void;
}

export const SettingsDialog: React.FC<SettingsDialogProps> = ({
  visible,
  onHide,
  jsonConfig,
  onConfigChange,
  configError,
  onConfigError,
}) => {
  const [testStatus, setTestStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [testMessage, setTestMessage] = useState<string | null>(null);
  const [editingTagIndex, setEditingTagIndex] = useState<number | null>(null);
  const [showAddTagForm, setShowAddTagForm] = useState(false);
  const [editingTag, setEditingTag] = useState<TagConfig>({
    key: "",
    name: "",
    colour: "#000000",
  });
  const [matcherError, setMatcherError] = useState<string | null>(null);

  // Draft state — snapshotted from the store when the dialog opens, committed on Save
  const [draftAutoUpdateEnabled, setDraftAutoUpdateEnabled] = useState(false);
  const [draftAutoUpdateUrl, setDraftAutoUpdateUrl] = useState("");
  const [draftAutoUpdateAuthToken, setDraftAutoUpdateAuthToken] = useState("");

  const initializeDraft = () => {
    const state = useConfigStore.getState();
    setDraftAutoUpdateEnabled(state.autoUpdateEnabled);
    setDraftAutoUpdateUrl(state.autoUpdateUrl);
    setDraftAutoUpdateAuthToken(state.autoUpdateAuthToken);
  };

  // Parse tags out of the draft jsonConfig so TagSettings always reflects the textarea
  const getTagsFromConfig = (): TagConfig[] => {
    try {
      const parsed = JSON.parse(jsonConfig);
      return Array.isArray(parsed.tags) ? parsed.tags : [];
    } catch {
      return [];
    }
  };

  const handleTagsChange = (newTags: TagConfig[]) => {
    try {
      const parsed = JSON.parse(jsonConfig);
      const updated = { ...parsed, tags: newTags.length > 0 ? newTags : undefined };
      onConfigChange(JSON.stringify(updated, null, 2));
    } catch {
      // jsonConfig is currently invalid JSON; can't update it
    }
  };

  const validateMatcherRegex = (matcher: string): boolean => {
    if (!matcher) {
      setMatcherError(null);
      return true;
    }
    try {
      new RegExp(`^${matcher}$`);
      setMatcherError(null);
      return true;
    } catch (err) {
      setMatcherError(`Invalid regex: ${err instanceof Error ? err.message : "Unknown error"}`);
      return false;
    }
  };

  const runConnectionTest = async () => {
    if (!draftAutoUpdateUrl) return;
    setTestStatus("loading");
    setTestMessage(null);
    try {
      const headers: Record<string, string> = {};
      if (draftAutoUpdateAuthToken) headers.Authorization = `Bearer ${draftAutoUpdateAuthToken}`;
      const response = await fetch(draftAutoUpdateUrl, { headers });
      if (!response.ok) {
        setTestStatus("error");
        setTestMessage(`HTTP ${response.status}: ${response.statusText}`);
        return;
      }
      let json: unknown;
      try {
        json = await response.json();
      } catch {
        setTestStatus("error");
        setTestMessage("Response is not valid JSON.");
        return;
      }
      const result = RemoteConfigSchema.safeParse(json);
      console.log("Validation result:", result);
      if (!result.success) {
        setTestStatus("error");
        setTestMessage(
          `Schema validation failed: ${result.error.issues.map((i) => `${i.path.join(".") || "root"}: ${i.message}`).join("; ")}`
        );
        return;
      }
      setTestStatus("success");
      setTestMessage(
        `Config updated — ${result.data.groups.length} top-level group(s), version ${result.data.version}.`
      );
      onConfigChange(JSON.stringify(result.data, null, 2));
    } catch (err) {
      setTestStatus("error");
      setTestMessage(`Fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <Dialog
      header="Settings"
      visible={visible}
      onHide={onHide}
      onShow={initializeDraft}
      modal
      style={{ width: "50vw" }}
    >
      <div className="settings-dialog">
        <div className="settings-content">
          <section className="auto-update-section">
            <h4 className="section-heading">Auto Update</h4>
            <div className="auto-update-toggle-row">
              <label htmlFor="auto-update-toggle">Enable auto update</label>
              <InputSwitch
                inputId="auto-update-toggle"
                checked={draftAutoUpdateEnabled}
                onChange={(e) => setDraftAutoUpdateEnabled(e.value ?? false)}
              />
            </div>
            {draftAutoUpdateEnabled && (
              <>
                <Message
                  severity="info"
                  className="auto-update-note"
                  text="Edit mode is hidden while auto update is enabled. Manage your group config via the remote URL below."
                />
                <div className="field">
                  <label htmlFor="auto-update-url">Config URL</label>
                  <div className="url-input-row">
                    <InputText
                      id="auto-update-url"
                      value={draftAutoUpdateUrl}
                      onChange={(e) => {
                        setDraftAutoUpdateUrl(e.target.value);
                        setTestStatus("idle");
                        setTestMessage(null);
                      }}
                      placeholder="https://example.com/config.json"
                      className="url-input"
                    />
                    <Button
                      label="Test"
                      icon={testStatus === "loading" ? "pi pi-spin pi-spinner" : "pi pi-bolt"}
                      outlined
                      disabled={!draftAutoUpdateUrl || testStatus === "loading"}
                      onClick={runConnectionTest}
                    />
                  </div>
                  {testStatus !== "idle" && (
                    <Message
                      severity={
                        testStatus === "success"
                          ? "success"
                          : testStatus === "error"
                            ? "error"
                            : "info"
                      }
                      text={testMessage ?? ""}
                      className="test-result-message"
                    />
                  )}
                </div>
                <div className="field">
                  <label htmlFor="auto-update-token">Auth Token (optional)</label>
                  <Password
                    inputId="auto-update-token"
                    value={draftAutoUpdateAuthToken}
                    onChange={(e) => setDraftAutoUpdateAuthToken(e.target.value)}
                    feedback={false}
                    toggleMask
                    placeholder="Bearer token"
                    className="w-full"
                    inputClassName="w-full"
                  />
                </div>
              </>
            )}
          </section>

          {!draftAutoUpdateEnabled && (
            <>
              <hr className="section-divider" />

              <TagSettings
                tags={getTagsFromConfig()}
                onTagsChange={handleTagsChange}
                editingTag={editingTag}
                onEditingTagChange={setEditingTag}
                editingTagIndex={editingTagIndex}
                onEditingTagIndexChange={setEditingTagIndex}
                showAddTagForm={showAddTagForm}
                onShowAddTagFormChange={setShowAddTagForm}
                matcherError={matcherError}
                onMatcherErrorChange={setMatcherError}
                onValidateMatcher={validateMatcherRegex}
              />
            </>
          )}

          <hr className="section-divider" />
          <Fieldset legend="Advanced Configuration" toggleable collapsed>
            <textarea
              id="json-config"
              value={jsonConfig}
              onChange={(e) => {
                onConfigChange(e.target.value);
                onConfigError(null);
              }}
              className="json-textarea"
              readOnly={draftAutoUpdateEnabled}
            />
            {configError && <div className="config-error">{configError}</div>}
          </Fieldset>
          <div className="dialog-buttons">
            <Button
              label="Save"
              onClick={() => {
                try {
                  const parsed = JSON.parse(jsonConfig);
                  const validated = RemoteConfigSchema.parse(parsed);
                  const {
                    setConfig,
                    setAutoUpdateEnabled,
                    setAutoUpdateUrl,
                    setAutoUpdateAuthToken,
                  } = useConfigStore.getState();
                  setConfig(validated);
                  setAutoUpdateEnabled(draftAutoUpdateEnabled);
                  setAutoUpdateUrl(draftAutoUpdateUrl);
                  setAutoUpdateAuthToken(draftAutoUpdateAuthToken);
                  onHide();
                  onConfigError(null);
                } catch (e) {
                  onConfigError(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
                }
              }}
              className="save-button"
            />
            <Button
              label="Reset to Defaults"
              outlined
              onClick={() => {
                onConfigChange(JSON.stringify({ version: 1, groups: [] }, null, 2));
                onConfigError(null);
              }}
            />
            <Button
              label="Cancel"
              outlined
              onClick={() => {
                onHide();
                onConfigError(null);
              }}
            />
          </div>
        </div>
      </div>
    </Dialog>
  );
};
