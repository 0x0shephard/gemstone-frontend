import { OperationsAccessGate } from '@/components/operations/OperationsAccessGate';
import { RedemptionDesk } from '@/components/operations/RedemptionDesk';

export default function CustodianPage() {
  return (
    <OperationsAccessGate capability="custodian.fulfill">
      <RedemptionDesk
        scope="custodian"
        capability="custodian.fulfill"
        title="Custodian delivery"
        description="Stones the bank has dispatched for redemption. Record the delivery at the pickup point or the customer's address; the customer then confirms the handover with their emailed code."
        empty="No dispatched redemptions are assigned to this custodian."
      />
    </OperationsAccessGate>
  );
}
