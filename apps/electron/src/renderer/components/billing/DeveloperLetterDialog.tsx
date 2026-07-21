/**
 * DeveloperLetterDialog - 开发者信封弹窗
 *
 * 信封翻开动画 → 信纸滑出 → 开发者声明 → 一次性购买
 */

import * as React from "react";
import { Dialog, DialogPortal, DialogOverlay } from "@/components/ui/dialog";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface DeveloperLetterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  selectedTierName: string;
  loading: boolean;
}

export function DeveloperLetterDialog({
  open,
  onOpenChange,
  onConfirm,
  selectedTierName,
  loading,
}: DeveloperLetterDialogProps): React.ReactElement {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          className={cn(
            "fixed left-[50%] top-[50%] z-[100] w-full max-w-xl translate-x-[-50%] translate-y-[-50%] titlebar-no-drag",
            "focus:outline-none",
          )}
          onPointerDownOutside={() => onOpenChange(false)}
        >
          {/* 自定义 keyframes */}
          <style>{`
            @keyframes envelope-flap-open {
              0% { transform: rotateX(0deg); }
              100% { transform: rotateX(-180deg); }
            }
            @keyframes letter-slide-up {
              0% { transform: translateY(60%); opacity: 0; }
              100% { transform: translateY(0); opacity: 1; }
            }
            @keyframes envelope-fade-in {
              0% { opacity: 0; transform: scale(0.9); }
              100% { opacity: 1; transform: scale(1); }
            }
          `}</style>

          {/* 信封容器 */}
          <div
            className="relative mx-auto w-full max-w-md"
            style={{
              perspective: "800px",
              animation: "envelope-fade-in 0.4s ease-out forwards",
            }}
          >
            {/* 信封体 */}
            <div className="relative rounded-b-2xl bg-[#d4a574] dark:bg-[#8b6914] shadow-2xl overflow-hidden">
              {/* 信封底部纹理 */}
              <div className="absolute inset-0 opacity-10 bg-[repeating-linear-gradient(45deg,transparent,transparent_10px,rgba(0,0,0,0.03)_10px,rgba(0,0,0,0.03)_20px)]" />

              {/* 信封内部（信纸滑出的背景） */}
              <div className="pt-6 pb-8 px-6">
                {/* 信纸 */}
                <div
                  className="relative bg-white dark:bg-stone-50 rounded-xl shadow-lg px-6 py-6 flex flex-col max-h-[70vh]"
                  style={{
                    animation: "letter-slide-up 0.5s ease-out 0.6s both",
                  }}
                >
                  {/* 信纸内容（可滚动） */}
                  <div className="space-y-4 text-stone-700 overflow-y-auto min-h-0 flex-1">
                    <p className="text-base font-medium">你好，</p>

                    <div className="text-sm leading-relaxed space-y-3">
                      <p>
                        感谢你选择{" "}
                        <span className="font-semibold text-stone-900">
                          {selectedTierName}
                        </span>{" "}
                        方案。
                      </p>
                      <p>在你开始购买额度之前，我想和你坦诚地聊几句。</p>
                      <p>
                        我希望能帮助大家快速上手 Agent 模式，同时把更多精力投入到 Proma 的持续迭代中。
                      </p>
                      <p>
                        Proma Cloud 将模型连接、额度、Agent 专用能力与云端工具整合在一起，让你无需配置多个 API Key 就能直接开始工作。
                      </p>
                      <p>
                        Proma Cloud 不追求成为最低报价的中转服务。我们优先保障模型质量、Agent 协议兼容、稳定性与可持续运营，同时在部分模型上提供有竞争力的专属优惠。
                      </p>
                      <p>
                        不同模型和任务的消耗不同，尤其是复杂 Agent 任务会产生多轮模型调用。请根据任务复杂度选择合适模型，并在余额页面查看可用额度与用量。
                      </p>
                      <p>
                        我们会持续改进模型可用性、Agent 体验和工具能力；也保留了你接入自有 API Key、Coding Plan 或其他服务的自由。
                      </p>
                      <p>
                        无论 AI 如何发展，Agent
                        能力如何强劲，请一定要记住人需要承担的责任，人永远是更好的上下文组织者和决策者。管理好预期的同时多加探索和讨论，切勿盲信国内自媒体瞎吹，没有什么是一键生成还能具备不可替代的价值的东西，一切的白领价值都来自于你无法传递的经验和洞察，Proma
                        会帮助你放大你的能力，保持冷静理性行事。
                      </p>
                      <p>
                        欢迎添加我的微信{" "}
                        <span className="font-mono font-semibold">
                          geekthings
                        </span>
                        ，加入我们的用户社区一起讨论 Proma 的使用和 AI
                        相关的话题。
                      </p>
                      <p className="text-right text-stone-500 text-xs pt-1">
                        —— Erlich，Proma 开发者
                      </p>
                    </div>
                  </div>

                  {/* 一次性购买按钮（固定在底部，不随内容滚动） */}
                  <p className="mt-4 text-center text-xs text-stone-500">
                    本次为一次性支付，不会自动续费或自动扣款。
                  </p>
                  <Button
                    className="w-full bg-stone-800 hover:bg-stone-700 text-white mt-2 flex-shrink-0"
                    size="default"
                    disabled={loading}
                    onClick={() => onConfirm()}
                  >
                    {loading ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : null}
                    确认一次性购买
                  </Button>
                </div>
              </div>
            </div>

            {/* 信封盖（三角形翻页） */}
            <div
              className="absolute top-0 left-0 right-0 z-10"
              style={{
                transformOrigin: "top center",
                animation: "envelope-flap-open 0.6s ease-in-out 0.3s both",
                transformStyle: "preserve-3d",
              }}
            >
              <div
                className="w-full bg-[#c49660] dark:bg-[#7a5a10]"
                style={{
                  clipPath: "polygon(0 0, 100% 0, 50% 100%)",
                  height: "80px",
                  backfaceVisibility: "hidden",
                }}
              />
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
