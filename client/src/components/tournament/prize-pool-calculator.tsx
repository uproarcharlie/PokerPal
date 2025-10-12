import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calculator, Lock } from "lucide-react";

interface Tournament {
  id: string;
  name: string;
  buyInAmount: string;
  rebuyAmount?: string;
  addonAmount?: string;
  rakeType: string;
  rakeAmount: string;
  enableHighHand?: boolean;
  highHandAmount?: string;
  highHandRakeType?: string;
  highHandRakeAmount?: string;
  highHandPayouts?: number;
}

interface PrizePoolCalculatorProps {
  tournament: Tournament;
  grossTotal: number;
  rake: number;
  netPrizePool: number;
  totalBuyIns: number;
  totalRebuys: number;
  totalAddons: number;
  highHandEntrants?: number;
}

export function PrizePoolCalculator({
  tournament,
  grossTotal,
  rake,
  netPrizePool,
  totalBuyIns,
  totalRebuys,
  totalAddons,
  highHandEntrants = 0,
}: PrizePoolCalculatorProps) {

  const formatCurrency = (amount: number) => {
    return `$${Math.round(amount).toLocaleString()}`;
  };

  const getRakeDisplay = () => {
    if (tournament.rakeType === 'percentage') {
      return `${tournament.rakeAmount}%`;
    } else if (tournament.rakeType === 'fixed') {
      return `$${tournament.rakeAmount} per entry`;
    }
    return 'No Rake';
  };

  // Calculate high hand pool based on entrants
  const highHandGross = highHandEntrants * parseFloat(tournament.highHandAmount || '0');
  const highHandRakeAmount = tournament.highHandRakeType === 'percentage'
    ? highHandGross * (parseFloat(tournament.highHandRakeAmount || '0') / 100)
    : parseFloat(tournament.highHandRakeAmount || '0');
  const highHandNet = highHandGross - highHandRakeAmount;
  const highHandPerWinner = tournament.highHandPayouts && tournament.highHandPayouts > 0
    ? highHandNet / tournament.highHandPayouts
    : highHandNet;

  return (
    <Card>
      <CardHeader className="border-b border-border">
        <CardTitle className="flex items-center gap-2">
          <Calculator className="w-5 h-5" />
          Prize Pool Calculator
        </CardTitle>
        <p className="text-sm text-muted-foreground">Real-time prize pool calculation</p>
      </CardHeader>
      <CardContent className="p-6 space-y-4">
        {grossTotal > 0 ? (
          <>
            <div className="space-y-3">
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-muted-foreground">
                  Buy-ins ({totalBuyIns} × ${tournament.buyInAmount})
                </span>
                <span className="text-sm font-semibold text-foreground" data-testid="buyins-total">
                  {formatCurrency(totalBuyIns * parseFloat(tournament.buyInAmount))}
                </span>
              </div>

              {tournament.rebuyAmount && totalRebuys > 0 && (
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm text-muted-foreground">
                    Re-buys ({totalRebuys} × ${tournament.rebuyAmount})
                  </span>
                  <span className="text-sm font-semibold text-foreground" data-testid="rebuys-total">
                    {formatCurrency(totalRebuys * parseFloat(tournament.rebuyAmount))}
                  </span>
                </div>
              )}

              {tournament.addonAmount && totalAddons > 0 && (
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm text-muted-foreground">
                    Add-ons ({totalAddons} × ${tournament.addonAmount})
                  </span>
                  <span className="text-sm font-semibold text-foreground" data-testid="addons-total">
                    {formatCurrency(totalAddons * parseFloat(tournament.addonAmount))}
                  </span>
                </div>
              )}
            </div>

            <div className="border-t border-border pt-3">
              <div className="flex items-center justify-between py-2">
                <span className="text-sm font-medium text-foreground">Gross Total</span>
                <span className="text-sm font-bold text-foreground" data-testid="gross-total">
                  {formatCurrency(grossTotal)}
                </span>
              </div>

              {tournament.rakeType !== 'none' && rake > 0 && (
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm text-muted-foreground">
                    Rake ({getRakeDisplay()})
                  </span>
                  <span className="text-sm text-destructive" data-testid="rake-amount">
                    -{formatCurrency(rake)}
                  </span>
                </div>
              )}
            </div>

            <div className="border-t-2 border-primary pt-3">
              <div className="flex items-center justify-between py-2">
                <span className="text-base font-bold text-foreground">Net Prize Pool</span>
                <span className="text-2xl font-bold text-primary" data-testid="net-prize-pool">
                  {formatCurrency(netPrizePool)}
                </span>
              </div>
            </div>

            {tournament.enableHighHand && tournament.highHandAmount && highHandEntrants > 0 && (
              <div className="border-t border-border pt-3">
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm text-muted-foreground">
                    High Hand Entries ({highHandEntrants} × ${tournament.highHandAmount})
                  </span>
                  <span className="text-sm font-semibold text-foreground">
                    {formatCurrency(highHandGross)}
                  </span>
                </div>

                {tournament.highHandRakeType && tournament.highHandRakeType !== 'none' && highHandRakeAmount > 0 && (
                  <div className="flex items-center justify-between py-2">
                    <span className="text-sm text-muted-foreground">
                      High Hand Rake ({tournament.highHandRakeType === 'percentage' ? `${tournament.highHandRakeAmount}%` : `$${tournament.highHandRakeAmount}`})
                    </span>
                    <span className="text-sm text-destructive">
                      -{formatCurrency(highHandRakeAmount)}
                    </span>
                  </div>
                )}

                <div className="flex items-center justify-between py-2">
                  <span className="text-sm font-medium text-foreground">Net High Hand Pool</span>
                  <span className="text-sm font-bold text-accent">
                    {formatCurrency(highHandNet)}
                  </span>
                </div>

                {tournament.highHandPayouts && tournament.highHandPayouts > 1 && (
                  <>
                    <div className="flex items-center justify-between py-2">
                      <span className="text-sm text-muted-foreground">Number of Winners</span>
                      <span className="text-sm font-semibold text-foreground">{tournament.highHandPayouts}</span>
                    </div>
                    <div className="flex items-center justify-between py-2">
                      <span className="text-sm font-medium text-foreground">Per Winner</span>
                      <span className="text-sm font-bold text-accent">
                        {formatCurrency(highHandPerWinner)}
                      </span>
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-8">
            <Calculator className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-sm text-muted-foreground">Prize pool will be calculated</p>
            <p className="text-xs text-muted-foreground mt-1">as players register and make entries</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
