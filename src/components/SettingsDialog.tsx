import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";
import type React from "react";
import { useGroupsStore } from "../utils/groupsStore";
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
  const { groups, setGroups } = useGroupsStore();

  return (
    <Dialog
      header="Settings"
      visible={visible}
      onHide={onHide}
      modal
      style={{ width: "50vw" }}
    >
      <div className="settings-dialog">
        <div className="settings-content">
          <label htmlFor="json-config">Configuration (JSON)</label>
          <textarea
            id="json-config"
            value={jsonConfig}
            onChange={(e) => {
              onConfigChange(e.target.value);
              onConfigError(null);
            }}
            className="json-textarea"
          />
          {configError && <div className="config-error">{configError}</div>}
          <div className="dialog-buttons">
            <Button
              label="Save"
              onClick={() => {
                try {
                  const parsed = JSON.parse(jsonConfig);
                  setGroups(parsed);
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
                const { resetToDefaults } = useGroupsStore.getState();
                resetToDefaults();
                onConfigChange(JSON.stringify(useGroupsStore.getState().groups, null, 2));
                onConfigError(null);
              }}
            />
            <Button
              label="Cancel"
              outlined
              onClick={() => {
                onHide();
                onConfigChange(JSON.stringify(groups, null, 2));
                onConfigError(null);
              }}
            />
          </div>
        </div>
      </div>
    </Dialog>
  );
};
