import { Toolbar } from "../toolbar/Toolbar";
import { BoneTreePanel } from "../panels/BoneTreePanel";
import { SlotListPanel } from "../panels/SlotListPanel";
import { PropertiesPanel } from "../panels/PropertiesPanel";
import { MainCanvas } from "../canvas/MainCanvas";
import { TimelinePanel } from "../timeline/TimelinePanel";
import { StatusBar } from "../statusbar/StatusBar";
import { HelpDialog } from "../help/HelpDialog";

export const EditorLayout = () => {
  return (
    <div className="flex flex-col h-screen ">
      <Toolbar />
      <HelpDialog />

      <div className="flex flex-1 overflow-hidden">
        <div className="w-[250px] flex-shrink-0 bg-panel border-r border-border flex flex-col overflow-hidden">
          <BoneTreePanel />
          <SlotListPanel />
        </div>

        <MainCanvas />

        <div className="w-[250px] flex-shrink-0 bg-panel border-l border-border">
          <PropertiesPanel />
        </div>
      </div>

      <TimelinePanel />
      <StatusBar />
    </div>
  );
};
