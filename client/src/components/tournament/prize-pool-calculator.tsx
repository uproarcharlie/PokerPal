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
}

interface PrizePoolCalculatorProps {
  tournament: Tournament;
  grossTotal: number;
  rake: number;
  netPrizePool: number;
}

export function PrizePoolCalculator({ 
  tournament, 
  grossTotal, 
  rake, 
  netPrizePool 
}: PrizePoolCalculatorProps) {
  
  const formatCurrency = (amount: number) => {
    return `$${Math.round(amount).toLocaleString()}`;
  };

  const getRakeDisplay = () => {
    if (tournament.rakeType === 'percentage') {
      return `${tournament.rakeAmount}%`;
    } else if (tournament.rakeType === 'fixed') {
      return `$${tournament.rakeAmount}`;
    }
    return 'No Rake';
  };

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
                  Buy-ins (${tournament.buyInAmount} each)
                </span>
                <span className="text-sm font-semibold text-foreground" data-testid="buyins-total">
                  {formatCurrency(parseFloat(tournament.buyInAmount) * (grossTotal / (parseFloat(tournament.buyInAmount) + parseFloat(tournament.rebuyAmount || '0') + parseFloat(tournament.addonAmount || '0'))))}
                </span>
              </div>
              
              {tournament.rebuyAmount && (
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm text-muted-foreground">
                    Re-buys (${tournament.rebuyAmount} each)
                  </span>
                  <span className="text-sm font-semibold text-foreground" data-testid="rebuys-total">
                    ${Math.round(grossTotal * 0.2).toLocaleString()}
                  </span>
                </div>
              )}
              
              {tournament.addonAmount && (
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm text-muted-foreground">
                    Add-ons (${tournament.addonAmount} each)
                  </span>
                  <span className="text-sm font-semibold text-foreground" data-testid="addons-total">
                    ${Math.round(grossTotal * 0.1).toLocaleString()}
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

            <Button className="w-full mt-4" data-testid="lock-prize-pool">
              <Lock className="w-4 h-4 mr-2" />
              Lock Prize Pool
            </Button>
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
