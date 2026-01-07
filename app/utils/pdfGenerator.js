// app/utils/pdfGenerator.js
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

export const generatePO = (itemsToPrint, shopDetails = {}, customOptions = {}) => {
  if (!itemsToPrint || itemsToPrint.length === 0) {
    alert("No items selected for PO.");
    return;
  }

  try {
    const doc = new jsPDF();
    const shopName = shopDetails.shopHandle
      ? shopDetails.shopHandle.toUpperCase().replace(/-/g, " ")
      : "MY STORE";

    // Support overriding the PO Number/Date (for re-printing saved POs)
    const { 
      poNumberOverride, 
      dateOverride 
    } = customOptions;

    // Group by Vendor if not already grouped (Handling single PO vs Bulk)
    const groupedItems = itemsToPrint.reduce((acc, item) => {
      const vendor = item.vendor || "Unknown Vendor";
      if (!acc[vendor]) acc[vendor] = [];
      acc[vendor].push(item);
      return acc;
    }, {});

    let yPos = 20;
    const rightMarginX = 195;

    Object.keys(groupedItems).forEach((vendor, index) => {
      // Filter items with 0 qty unless specifically forced (e.g. from saved PO)
      const itemsToOrder = groupedItems[vendor].filter(
        (i) => (i.quantity || i.suggestedOrderQty) > 0
      );

      if (itemsToOrder.length === 0) return;

      if (index > 0) {
        doc.addPage();
        yPos = 20;
      }

      // --- Header ---
      const displayPoNumber = poNumberOverride 
        ? `PO-${poNumberOverride}`
        : `PO-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
      
      const displayDate = dateOverride 
        ? new Date(dateOverride).toLocaleDateString() 
        : new Date().toLocaleDateString();

      doc.setFontSize(16);
      doc.setFont("helvetica", "bold");
      doc.text("PURCHASE ORDER", rightMarginX, yPos, { align: "right" });
      yPos += 10;

      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.text(`PO #: ${displayPoNumber}`, rightMarginX, yPos, { align: "right" });
      yPos += 6;
      doc.text(`Date: ${displayDate}`, rightMarginX, yPos, { align: "right" });

      // --- Addresses ---
      let addressYStart = 30;

      // SHIP TO
      doc.setFont("helvetica", "bold");
      doc.text("SHIP TO:", 14, addressYStart);
      doc.setFont("helvetica", "normal");
      addressYStart += 6;
      doc.text(shopName, 14, addressYStart);
      addressYStart += 6;
      doc.text("123 Store Street", 14, addressYStart);
      addressYStart += 6;
      doc.text("City, State, Zip", 14, addressYStart);

      // VENDOR
      addressYStart = 30; 
      const vendorX = 110;
      doc.setFont("helvetica", "bold");
      doc.text("VENDOR:", vendorX, addressYStart);
      doc.setFont("helvetica", "normal");
      addressYStart += 6;
      doc.text(vendor, vendorX, addressYStart);
      addressYStart += 6;
      doc.text("Vendor Address", vendorX, addressYStart); // Placeholder

      yPos = 70;

      // --- Table ---
      let vendorSubtotal = 0;

      const tableColumn = ["SKU", "Item Name", "Quantity", "Unit Cost", "Total"];
      const tableRows = itemsToOrder.map((item) => {
        // Handle both 'suggestedOrderQty' (Analyze page) and 'quantity' (Saved PO)
        const orderQty = item.quantity !== undefined ? item.quantity : item.suggestedOrderQty;
        const unitCost = item.cost || 0;
        const lineTotal = orderQty * unitCost;
        vendorSubtotal += lineTotal;

        return [
          item.sku || "N/A",
          item.title.substring(0, 45),
          orderQty,
          `$${unitCost.toFixed(2)}`,
          `$${lineTotal.toFixed(2)}`,
        ];
      });

      autoTable(doc, {
        startY: yPos,
        head: [tableColumn],
        body: tableRows,
        theme: "plain",
        headStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: "bold" },
        columnStyles: { 2: { halign: "center" }, 3: { halign: "right" }, 4: { halign: "right" } },
      });

      yPos = doc.lastAutoTable.finalY + 10;

      // --- Totals ---
      doc.text(`Subtotal: $${vendorSubtotal.toFixed(2)}`, rightMarginX, yPos, { align: "right" });
      yPos += 6;
      doc.text("Tax (0%): $0.00", rightMarginX, yPos, { align: "right" });
      yPos += 2;
      doc.line(150, yPos, rightMarginX, yPos);
      yPos += 6;
      doc.setFont("helvetica", "bold");
      doc.text(`TOTAL: $${vendorSubtotal.toFixed(2)}`, rightMarginX, yPos, { align: "right" });
    });

    const fileName = customOptions.poNumberOverride 
      ? `PO_${customOptions.poNumberOverride}.pdf`
      : `PO_${new Date().toISOString().slice(0, 10)}.pdf`;

    doc.save(fileName);
  } catch (error) {
    console.error("PDF Gen Error:", error);
    alert("Error generating PDF.");
  }
};