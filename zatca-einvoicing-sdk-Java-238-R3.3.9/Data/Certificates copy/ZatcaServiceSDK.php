<?php
require_once(__DIR__ . '/../../LIB/DB.php');
require_once(__DIR__ . '/phpqrcode.php');

/**
 * SDK-flavoured signer: standalone copy of ZatcaService whose signing path
 * shells out to the ZATCA Java SDK's fatoora binary instead of doing the
 * cryptography in pure PHP. Everything else (UBL XML, ZATCA API call, DB,
 * onboarding) is identical to ZatcaService — so both classes can be
 * maintained independently without affecting each other.
 *
 * SDK discovery is silent: if no SDK is found at construction time,
 * processInvoice() returns a clean error envelope. No fallback to OpenSSL.
 */
class ZatcaServiceSDK {
    private $db;
    private $scriptDir;
    private $dataDir;
    private $certDir;
    private $pihFile;
    private $inputDir;
    private $xmlDir;
    private $qrDir;
    private $jsonDir;
    private $opensslExe;
    private $zatcaApiBase;
    private $zatcaEnv;

    // SDK-only fields
    private $sdkRoot;       // null if SDK not found
    private $sdkConfig;     // resolved config paths (cert/key/PIH/input/...)
    private $fatooraCmd;    // path to fatoora binary (kept for fallback)
    private $sdkJar;        // full path to the SDK jar — used for direct java invocation
    private $sdkVersion;    // jar version string (e.g. "238-R3.3.9")

    public function __construct() {
        $this->db = DB::getInstance();
        $this->scriptDir = __DIR__;
        // App-side outputs stay project-local — these are not SDK inputs.
        $this->xmlDir    = $this->scriptDir . DIRECTORY_SEPARATOR . 'xml';
        $this->qrDir     = $this->scriptDir . DIRECTORY_SEPARATOR . 'qrcode';
        $this->jsonDir   = $this->scriptDir . DIRECTORY_SEPARATOR . 'json';
        $this->detectEnvironment(); // sets opensslExe, zatcaEnv, zatcaApiBase only
        $this->loadSdk();           // silent — sdkRoot stays null on miss

        // ALL data paths come from the SDK. No project-local fallback.
        // If the SDK isn't present, these remain null; processInvoice and
        // onboarding will return clean errors instead of writing to a
        // throwaway data/ folder that fatoora.bat would never read.
        if ($this->sdkRoot) {
            $this->dataDir  = $this->sdkRoot . DIRECTORY_SEPARATOR . 'Data';
            $this->certDir  = dirname($this->sdkConfig['certPath']);
            $this->inputDir = $this->sdkConfig['inputPath'];
            $this->pihFile  = $this->sdkConfig['pihPath'];
        }

        foreach ([$this->xmlDir, $this->qrDir, $this->jsonDir] as $dir) {
            if (!is_dir($dir)) @mkdir($dir, 0777, true);
        }
        if ($this->sdkRoot) {
            foreach ([$this->certDir, $this->inputDir] as $dir) {
                if (!is_dir($dir)) @mkdir($dir, 0777, true);
            }
        }
    }

    private function detectEnvironment() {
        $host = $_SERVER['HTTP_HOST'] ?? $_SERVER['SERVER_NAME'] ?? '';
        $dir  = $this->scriptDir;

        $hostMatch = (
            stripos($host, 'erp.threearrowplastic.com') !== false ||
            stripos($host, '54.237.33.18') !== false
        );
        $dirMatch = (bool) preg_match('#/(al-rukan|Three-arrows)/#i', $dir);

        $this->opensslExe = 'openssl';
        // certDir / inputDir / pihFile are NOT set here — they come from the
        // SDK in __construct() after loadSdk(). No project-local fallback.

        // Keep zatcaEnv and zatcaApiBase in lock-step. Hardcoding zatcaEnv to
        // 'production' while zatcaApiBase fell back to developer-portal caused
        // the API URL builder to point at the production endpoint with sandbox
        // credentials → 401.
        if ($hostMatch && $dirMatch) {
            $this->zatcaEnv     = 'production';
            $this->zatcaApiBase = 'https://gw-fatoora.zatca.gov.sa/e-invoicing/core';
        } else {
            $this->zatcaEnv     = 'developer-portal';
            $this->zatcaApiBase = 'https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal';
        }
    }

    private function applyCurlSsl($ch) {
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
        curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 0);
        curl_setopt($ch, CURLOPT_SSLVERSION,     CURL_SSLVERSION_TLSv1_2);
    }

    private function getInvoiceApiUrl($type) {
        // $type: 'reporting' or 'clearance'
        if ($this->zatcaEnv === 'production') {
            return 'https://gw-fatoora.zatca.gov.sa/e-invoicing/core/invoices/' . $type . '/single';
        }
        //  elseif ($this->zatcaEnv === 'simulation') {
        //     return 'https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation/invoices/' . $type . '/single';
        // } 
        else {
            // developer-portal uses a single compliance endpoint
            return $this->zatcaApiBase . '/compliance/invoices';
        }
    }

    // ------------------------------------------------------------------
    // Helper functions (mirroring Python)
    // ------------------------------------------------------------------

    private function generateUuidFromInt($inputInt) {
        $h = md5((string)$inputInt);
        return sprintf('%s-%s-%s-%s-%s',
            substr($h, 0, 8),
            substr($h, 8, 4),
            dechex(hexdec(substr($h, 12, 4)) | 0x4000),
            dechex(hexdec(substr($h, 16, 4)) | 0x8000),
            substr($h, 20, 12)
        );
    }

    private function formatNumber($num, $decimals = 2) {
        return number_format((float)$num, $decimals, '.', '');
    }

    // TLV encode with BER length (exactly as Python)
    private function tlvEncode($tag, $value) {
        $len = strlen($value);
        if ($len < 128) {
            return chr($tag) . chr($len) . $value;
        } else {
            $lenBytes = '';
            $tmp = $len;
            while ($tmp > 0) {
                $lenBytes = chr($tmp & 0xFF) . $lenBytes;
                $tmp >>= 8;
            }
            return chr($tag) . chr(0x80 | strlen($lenBytes)) . $lenBytes . $value;
        }
    }

    // ------------------------------------------------------------------
    // ASN.1 DER helpers — pure PHP, mirrors Python cryptography library
    // ------------------------------------------------------------------

    private function derLen($data) {
        $len = strlen($data);
        if ($len < 0x80) return chr($len);
        if ($len < 0x100) return "\x81" . chr($len);
        return "\x82" . chr($len >> 8) . chr($len & 0xFF);
    }

    private function derTag($tag, $data) {
        return chr($tag) . $this->derLen($data) . $data;
    }

    private function derSeqC($d)     { return $this->derTag(0x30, $d); }
    private function derSetC($d)     { return $this->derTag(0x31, $d); }
    private function derOid($hex)    { return $this->derTag(0x06, hex2bin($hex)); }
    private function derUtf8($s)     { return $this->derTag(0x0C, $s); }
    private function derPrintable($s){ return $this->derTag(0x13, $s); }
    private function derOctetStr($d) { return $this->derTag(0x04, $d); }
    private function derBitStr($d)   { return $this->derTag(0x03, "\x00" . $d); }
    private function derCtx0($d)     { return $this->derTag(0xA0, $d); }
    private function derCtxA4($d)    { return $this->derTag(0xA4, $d); } // [4] EXPLICIT for directoryName

    // RDN: SET { SEQUENCE { OID, value } }
    private function derRdn($oidHex, $value, $strTag = 0x0C) {
        return $this->derSetC($this->derSeqC(
            $this->derOid($oidHex) . $this->derTag($strTag, $value)
        ));
    }

    // Name SEQUENCE for CSR subject (mirrors Python subject = x509.Name([...]))
    private function csrBuildSubject($config) {
        return $this->derSeqC(
            $this->derRdn('550406', $config['country'] ?: 'SA', 0x13) . // 2.5.4.6  countryName (PrintableString)
            $this->derRdn('55040b', $config['ou']      ?: '', 0x0C) .   // 2.5.4.11 organizationalUnitName
            $this->derRdn('55040a', $config['org']     ?: '', 0x0C) .   // 2.5.4.10 organizationName
            $this->derRdn('550403', $config['cn']      ?: '', 0x0C)     // 2.5.4.3  commonName
        );
    }

    // Inner Name for SAN DirectoryName (mirrors Python san DirectoryName attributes)
    private function csrBuildSanName($config) {
        return $this->derSeqC(
            $this->derRdn('550404',               $config['sn']                ?: '', 0x0C) . // 2.5.4.4  surname
            $this->derRdn('0992268993f22c640101', $config['uid']               ?: '', 0x0C) . // 0.9.2342.19200300.100.1.1 userId
            $this->derRdn('55040c',               $config['title']             ?: '', 0x0C) . // 2.5.4.12 title
            $this->derRdn('55041a',               $config['address']           ?: '', 0x0C) . // 2.5.4.26 registeredAddress
            $this->derRdn('55040f',               $config['business_category'] ?: '', 0x0C)   // 2.5.4.15 businessCategory
        );
    }

    // [0] IMPLICIT attributes block: extensionRequest containing ZATCA template + SAN
    private function csrBuildAttributes($config) {
        // ZATCA template extension (1.3.6.1.4.1.311.20.2): raw value = UTF8String "ZATCA-Code-Signing"
        $zatcaExt = $this->derSeqC(
            $this->derOid('2b0601040182371402') .           // OID 1.3.6.1.4.1.311.20.2
            $this->derOctetStr("\x0C\x12ZATCA-Code-Signing") // extnValue wraps raw DER bytes
        );

        // SAN extension (2.5.29.17): GeneralNames { [4] Name }
        $generalNames = $this->derSeqC($this->derCtxA4($this->csrBuildSanName($config)));
        $sanExt = $this->derSeqC(
            $this->derOid('551d11') .                       // OID 2.5.29.17 subjectAltName
            $this->derOctetStr($generalNames)
        );

        // extensionRequest attribute (1.2.840.113549.1.9.14)
        $extReqAttr = $this->derSeqC(
            $this->derOid('2a864886f70d01090e') .           // OID 1.2.840.113549.1.9.14
            $this->derSetC($this->derSeqC($zatcaExt . $sanExt))
        );

        return $this->derCtx0($extReqAttr);
    }

    // Remove DOM node from its parent (PHP DOM keeps adjacent text nodes intact, no tail handling needed)
    private function removeNodePreserveTail($node) {
        if ($node->parentNode) {
            $node->parentNode->removeChild($node);
        }
    }

    // Register all required namespaces for XPath
    private function registerNamespaces($xpath) {
        $xpath->registerNamespace('ext', 'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2');
        $xpath->registerNamespace('cac', 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2');
        $xpath->registerNamespace('cbc', 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2');
        $xpath->registerNamespace('sig', 'urn:oasis:names:specification:ubl:schema:xsd:CommonSignatureComponents-2');
        $xpath->registerNamespace('sac', 'urn:oasis:names:specification:ubl:schema:xsd:SignatureAggregateComponents-2');
        $xpath->registerNamespace('sbc', 'urn:oasis:names:specification:ubl:schema:xsd:SignatureBasicComponents-2');
        $xpath->registerNamespace('ds', 'http://www.w3.org/2000/09/xmldsig#');
        $xpath->registerNamespace('xades', 'http://uri.etsi.org/01903/v1.3.2#');
    }

    // ------------------------------------------------------------------
    // UBL XML creation (identical to Python)
    // ------------------------------------------------------------------
    public function createUblXml($invoiceId, $invType) {
        $db = $this->db;
        
        if ($invType == "SALES") {
            $stmt = $db->prepare("SELECT * FROM zatca_info WHERE custom_inv_no=(SELECT custom_inv_no FROM sales_info WHERE InvoiceID=?)");
            $stmt->execute([$invoiceId]);
            $zatcaInfo = $stmt->fetch(PDO::FETCH_ASSOC);
        } else {
            $stmt = $db->prepare("SELECT * FROM zatca_info WHERE custom_inv_no=?");
            $stmt->execute([$invoiceId]);
            $zatcaInfo = $stmt->fetch(PDO::FETCH_ASSOC);
        }
        $fmtDate = ($zatcaInfo && $zatcaInfo['date']) ? $zatcaInfo['date'] : null;

        $stmt = $db->prepare("
            SELECT s.*, sd.Quantity, sd.ProductPrice, sd.ProductCode,
                   (SELECT product_name FROM product_info WHERE product_id = sd.ProductCode) AS item_description
            FROM sales_info s
            INNER JOIN sales_details sd USING (InvoiceID)
            WHERE s.InvoiceID = ?
        ");
        $stmt->execute([$invoiceId]);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
        if (!$rows) throw new Exception("Invoice $invoiceId not found");
        $first = $rows[0];
        $invTypeStr  = $first['InvoiceType'];
        // For SALES_RETURN, fetch_invoices.php joins zatca_info ON s.InvoiceID = z.custom_inv_no
        // so we must use InvoiceID as the zatca_info key, not sales_info.custom_inv_no
        $customInvNo = ($invTypeStr === 'SALES_RETURN') ? (string)$invoiceId : $first['custom_inv_no'];

        $phi = $db->query("SELECT id, custom_inv_no, pre_inv_id_hash FROM zatca_info WHERE signed_status='SIGNED' ORDER BY date DESC LIMIT 1")->fetch(PDO::FETCH_ASSOC);
        if (!$phi) {
            $zatcaId = 1;
            $prevHash = 'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==';
        } else {
            $zatcaId = ($phi['custom_inv_no'] == $customInvNo) ? $phi['id'] : $phi['id'] + 1;
            $prevHash = $phi['pre_inv_id_hash'];
        }

        $customUuid = $this->generateUuidFromInt($zatcaId);
        $dt = $fmtDate ? new DateTime($fmtDate) : new DateTime();
        $issueDate = $dt->format('Y-m-d');
        $issueTime = $dt->format('H:i:s');

        $seller = $db->query("SELECT * FROM csr_info LIMIT 1")->fetch(PDO::FETCH_ASSOC);
        $buyerId = ($invTypeStr == "SALES") ? $first['InvoiceTo'] : $first['InvoiceBy'];
        $stmt = $db->prepare("SELECT * FROM customer_info WHERE customer_id=?");
        $stmt->execute([$buyerId]);
        $buyer = $stmt->fetch(PDO::FETCH_ASSOC);

        $safeStr = function($v) {
            if ($v === null) return '';
            $s = trim((string)$v);
            $upper = strtoupper($s);
            if (in_array($upper, ['(NULL)', 'NULL', 'N/A', 'NA', '', '-'])) return '';
            return $s;
        };
        if ($buyer) {
            $buyer['vat_id'] = $safeStr($buyer['vat_id'] ?? null);
            $buyer['cr_number'] = $safeStr($buyer['cr_number'] ?? null);
        }
        $buyerVatId = ($buyer && isset($buyer['vat_id'])) ? $buyer['vat_id'] : '';

        $netList  = [];
        $taxList  = [];
        $discList = [];
        $linesXml = "";
        $taxCat = ($first['sales_type'] == "Domestic") ? 'S' : 'E';
        $vatPct = ($taxCat == 'S') ? 15 : 0;
        $exportXml = ($taxCat == 'S') ? "" : '<cbc:TaxExemptionReasonCode>VATEX-SA-32</cbc:TaxExemptionReasonCode><cbc:TaxExemptionReason>Export of goods</cbc:TaxExemptionReason>';

        foreach ($rows as $i => $row) {
            $price = (float)$row['ProductPrice'];
            $qty = (float)$row['Quantity'];
            $gross = $price * $qty;
            $disc = ($gross * (float)($row['discount_percent'] ?? 0)) / 100;
            $net = $gross - $disc;
            $tax = ($net * $vatPct) / 100;

            $netFmt = $this->formatNumber($net);
            $taxFmt = $this->formatNumber($tax);
            $discFmt = $this->formatNumber($disc);
            $roundingFmt = $this->formatNumber((float)$netFmt + (float)$taxFmt);

            $netList[]  = $netFmt;
            $taxList[]  = $taxFmt;
            $discList[] = $discFmt;

            $allowanceXml = ($disc > 0) ? '
            <cac:AllowanceCharge>
                <cbc:ChargeIndicator>false</cbc:ChargeIndicator>
                <cbc:AllowanceChargeReason>discount</cbc:AllowanceChargeReason>
                <cbc:Amount currencyID="SAR">' . $discFmt . '</cbc:Amount>
            </cac:AllowanceCharge>' : '';

            $linesXml .= '
        <cac:InvoiceLine>
            <cbc:ID>' . ($i + 1) . '</cbc:ID>
            <cbc:InvoicedQuantity unitCode="PCS">' . $qty . '</cbc:InvoicedQuantity>
            <cbc:LineExtensionAmount currencyID="SAR">' . $netFmt . '</cbc:LineExtensionAmount>' . $allowanceXml . '
            <cac:TaxTotal>
                <cbc:TaxAmount currencyID="SAR">' . $taxFmt . '</cbc:TaxAmount>
                <cbc:RoundingAmount currencyID="SAR">' . $roundingFmt . '</cbc:RoundingAmount>
            </cac:TaxTotal>
            <cac:Item>
                <cbc:Name>' . htmlspecialchars($row['item_description'] ?: 'N/A', ENT_XML1) . '</cbc:Name>
                <cac:ClassifiedTaxCategory>
                    <cbc:ID>' . $taxCat . '</cbc:ID>
                    <cbc:Percent>' . $vatPct . '</cbc:Percent>
                    ' . $exportXml . '
                    <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
                </cac:ClassifiedTaxCategory>
            </cac:Item>
            <cac:Price>
                <cbc:PriceAmount currencyID="SAR">' . $this->formatNumber($price, 4) . '</cbc:PriceAmount>
            </cac:Price>
        </cac:InvoiceLine>';
        }

        $totalNet  = array_sum(array_map('floatval', $netList));
        $totalTax  = array_sum(array_map('floatval', $taxList));
        $totalDisc = array_sum(array_map('floatval', $discList));
        $lineExtTotalFmt  = $this->formatNumber($totalNet);
        $totalTaxFmt      = $this->formatNumber($totalTax);
        $totalDiscFmt     = $this->formatNumber($totalDisc);
        $taxInclusiveFmt  = $this->formatNumber($totalNet + $totalTax);
        $taxInclusiveRaw  = $totalNet + $totalTax;

        $typeCode = "388";
        $typeName = $buyerVatId ? "0100000" : "0200000";
        $billingReference = "-";
        $instructionNote = "-";

        $refStmt = $db->prepare("SELECT id FROM zatca_info WHERE custom_inv_no=?");
        $refStmt->execute([$invoiceId]);
        $prevRow = $refStmt->fetch(PDO::FETCH_ASSOC);
        $prevZatcaId = $prevRow ? (string)$prevRow['id'] : null;
        $existingAmt = (float)($zatcaInfo['invoice_amount'] ?? 0);

        if (!$buyerVatId) {
            if ($invTypeStr == "SALES_RETURN") {
                if ($totalTax == 0) {
                    $typeName = "0211010"; $typeCode = "383";
                    $instructionNote = "Returned items?";
                } else {
                    $typeName = "0200000"; $typeCode = "381";
                    $instructionNote = "In case of goods or services refund";
                }
                if ($prevZatcaId) $billingReference = $prevZatcaId;
            } elseif ($zatcaInfo && $existingAmt > $taxInclusiveRaw) {
                $typeName = "0211010"; $typeCode = "381";
                $instructionNote = "Returned items";
                if ($prevZatcaId) $billingReference = $prevZatcaId;
            } elseif ($zatcaInfo && $existingAmt < $taxInclusiveRaw) {
                $typeName = "0211010"; $typeCode = "383";
                $instructionNote = "In case of goods or services refund";
                if ($prevZatcaId) $billingReference = $prevZatcaId;
            }
        } else {
            if ($invTypeStr == "SALES_RETURN") {
                $typeName = "0100000"; $typeCode = "381";
                $instructionNote = "CANCELLATION_OR_TERMINATION";
                if ($prevZatcaId) $billingReference = $prevZatcaId;
            } elseif ($zatcaInfo && $existingAmt > $taxInclusiveRaw) {
                $typeName = "0100000"; $typeCode = "381";
                $instructionNote = "CANCELLATION_OR_TERMINATION";
                if ($prevZatcaId) $billingReference = $prevZatcaId;
            } elseif ($zatcaInfo && $existingAmt < $taxInclusiveRaw) {
                $typeName = "0100000"; $typeCode = "383";
                $instructionNote = "CANCELLATION_OR_TERMINATION";
                if ($prevZatcaId) $billingReference = $prevZatcaId;
            }
        }

        $paymentMeans = ($first['Payment_term'] == "Cash") ? '1' : '2';

        $xml = '<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"><ext:UBLExtensions><ext:UBLExtension><ext:ExtensionURI>urn:oasis:names:specification:ubl:dsig:enveloped:xades</ext:ExtensionURI><ext:ExtensionContent><!-- Placeholder --></ext:ExtensionContent></ext:UBLExtension></ext:UBLExtensions>
        <cbc:ProfileID>reporting:1.0</cbc:ProfileID><cbc:ID>' . $zatcaId . '</cbc:ID><cbc:UUID>' . $customUuid . '</cbc:UUID><cbc:IssueDate>' . $issueDate . '</cbc:IssueDate><cbc:IssueTime>' . $issueTime . '</cbc:IssueTime><cbc:InvoiceTypeCode name="' . $typeName . '">' . $typeCode . '</cbc:InvoiceTypeCode><cbc:DocumentCurrencyCode>SAR</cbc:DocumentCurrencyCode><cbc:TaxCurrencyCode>SAR</cbc:TaxCurrencyCode>
        <cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>' . $billingReference . '</cbc:ID></cac:InvoiceDocumentReference></cac:BillingReference>
        <cac:AdditionalDocumentReference><cbc:ID>ICV</cbc:ID><cbc:UUID>' . $zatcaId . '</cbc:UUID></cac:AdditionalDocumentReference>
        <cac:AdditionalDocumentReference><cbc:ID>PIH</cbc:ID><cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">' . $prevHash . '</cbc:EmbeddedDocumentBinaryObject></cac:Attachment></cac:AdditionalDocumentReference>
        <cac:AdditionalDocumentReference><cbc:ID>QR</cbc:ID><cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain"></cbc:EmbeddedDocumentBinaryObject></cac:Attachment></cac:AdditionalDocumentReference>
        <cac:Signature><cbc:ID>urn:oasis:names:specification:ubl:signature:Invoice</cbc:ID><cbc:SignatureMethod>urn:oasis:names:specification:ubl:dsig:enveloped:xades</cbc:SignatureMethod></cac:Signature>
        <cac:AccountingSupplierParty><cac:Party><cac:PartyIdentification><cbc:ID schemeID="CRN">1010419747</cbc:ID></cac:PartyIdentification><cac:PostalAddress><cbc:StreetName>-</cbc:StreetName><cbc:AdditionalStreetName>-</cbc:AdditionalStreetName><cbc:BuildingNumber>2564</cbc:BuildingNumber><cbc:PlotIdentification>2564</cbc:PlotIdentification><cbc:CitySubdivisionName>-</cbc:CitySubdivisionName><cbc:CityName>-</cbc:CityName><cbc:PostalZone>12564</cbc:PostalZone><cbc:CountrySubentity>-</cbc:CountrySubentity><cac:Country><cbc:IdentificationCode>SA</cbc:IdentificationCode></cac:Country></cac:PostalAddress><cac:PartyTaxScheme><cbc:CompanyID>' . htmlspecialchars($seller['csr_organization_identifier'] ?? '', ENT_XML1) . '</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme><cac:PartyLegalEntity><cbc:RegistrationName>' . htmlspecialchars($seller['csr_organization_name'] ?? '', ENT_XML1) . '</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party></cac:AccountingSupplierParty>
        <cac:AccountingCustomerParty><cac:Party>' . ($buyer && $buyer['cr_number'] ? '<cac:PartyIdentification><cbc:ID schemeID="CRN">' . htmlspecialchars($buyer['cr_number'], ENT_XML1) . '</cbc:ID></cac:PartyIdentification>' : '') . '<cac:PostalAddress><cbc:StreetName>-</cbc:StreetName><cbc:AdditionalStreetName>-</cbc:AdditionalStreetName><cbc:BuildingNumber>1235</cbc:BuildingNumber><cbc:PlotIdentification>2563</cbc:PlotIdentification><cbc:CitySubdivisionName>-</cbc:CitySubdivisionName><cbc:CityName>-</cbc:CityName><cbc:PostalZone>35264</cbc:PostalZone><cbc:CountrySubentity>-</cbc:CountrySubentity><cac:Country><cbc:IdentificationCode>SA</cbc:IdentificationCode></cac:Country></cac:PostalAddress><cac:PartyTaxScheme><cbc:CompanyID>' . htmlspecialchars($buyer['vat_id'] ?? '', ENT_XML1) . '</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme><cac:PartyLegalEntity><cbc:RegistrationName>' . htmlspecialchars($buyer['company_name'] ?? '-', ENT_XML1) . '</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party></cac:AccountingCustomerParty>
        <cac:Delivery><cbc:ActualDeliveryDate>' . $issueDate . '</cbc:ActualDeliveryDate><cbc:LatestDeliveryDate>' . $issueDate . '</cbc:LatestDeliveryDate></cac:Delivery>
        <cac:PaymentMeans><cbc:PaymentMeansCode>' . $paymentMeans . '</cbc:PaymentMeansCode><cbc:InstructionNote>' . $instructionNote . '</cbc:InstructionNote></cac:PaymentMeans>
        <cac:TaxTotal><cbc:TaxAmount currencyID="SAR">' . $totalTaxFmt . '</cbc:TaxAmount></cac:TaxTotal>
        <cac:TaxTotal><cbc:TaxAmount currencyID="SAR">' . $totalTaxFmt . '</cbc:TaxAmount><cac:TaxSubtotal><cbc:TaxableAmount currencyID="SAR">' . $lineExtTotalFmt . '</cbc:TaxableAmount><cbc:TaxAmount currencyID="SAR">' . $totalTaxFmt . '</cbc:TaxAmount><cac:TaxCategory><cbc:ID schemeID="UN/ECE 5305">' . $taxCat . '</cbc:ID><cbc:Percent>' . $vatPct . '</cbc:Percent>' . $exportXml . '<cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal></cac:TaxTotal>
        <cac:LegalMonetaryTotal>
            <cbc:LineExtensionAmount currencyID="SAR">' . $lineExtTotalFmt . '</cbc:LineExtensionAmount>
            <cbc:TaxExclusiveAmount currencyID="SAR">' . $lineExtTotalFmt . '</cbc:TaxExclusiveAmount>
            <cbc:TaxInclusiveAmount currencyID="SAR">' . $taxInclusiveFmt . '</cbc:TaxInclusiveAmount>
            <cbc:AllowanceTotalAmount currencyID="SAR">0.00</cbc:AllowanceTotalAmount>
            <cbc:ChargeTotalAmount currencyID="SAR">0.00</cbc:ChargeTotalAmount>
            <cbc:PrepaidAmount currencyID="SAR">0.00</cbc:PrepaidAmount>
            <cbc:PayableAmount currencyID="SAR">' . $taxInclusiveFmt . '</cbc:PayableAmount>
        </cac:LegalMonetaryTotal>
        ' . $linesXml . '</Invoice>';

        $xmlPath = $this->xmlDir . DIRECTORY_SEPARATOR . $customInvNo . ".xml";
        file_put_contents($xmlPath, trim($xml));

        $metadata = [
            "zatca_id" => $zatcaId,
            "custom_inv_no" => $customInvNo,
            "previous_invoice_hash" => $prevHash,
            "now_str" => date('Y-m-d H:i:s'),
            "uuid" => $customUuid,
            "total_inv" => (float)$taxInclusiveFmt,
            "invoice_type_str" => $invTypeStr
        ];
        return [$metadata, $xmlPath];
    }

    // ------------------------------------------------------------------
    // Signing (two‑pass, exact XPath transforms, tail preservation)
   
public function signInvoice($xmlPath, $signedPath, $privKeyPath, $certPath)
{
    // =========================================================
    // LOAD PRIVATE KEY
    // =========================================================

    $keyB64 = trim(file_get_contents($privKeyPath));

    if (strpos($keyB64, '-----BEGIN') === false) {

        $privKeyPem =
            "-----BEGIN PRIVATE KEY-----\n" .
            chunk_split($keyB64, 64, "\n") .
            "-----END PRIVATE KEY-----\n";

        $privKeyId = openssl_pkey_get_private($privKeyPem);

        if (!$privKeyId) {

            $privKeyPem =
                "-----BEGIN EC PRIVATE KEY-----\n" .
                chunk_split($keyB64, 64, "\n") .
                "-----END EC PRIVATE KEY-----\n";

            $privKeyId = openssl_pkey_get_private($privKeyPem);
        }

    } else {

        $privKeyId = openssl_pkey_get_private($keyB64);
    }

    if (!$privKeyId) {
        throw new Exception(
            "Failed to load private key: " .
            openssl_error_string()
        );
    }

    // =========================================================
    // LOAD CERTIFICATE
    // =========================================================

    $certB64 = trim(file_get_contents($certPath));
    $certDer = base64_decode($certB64);

    $certPem =
        "-----BEGIN CERTIFICATE-----\n" .
        chunk_split(base64_encode($certDer), 64, "\n") .
        "-----END CERTIFICATE-----\n";

    // =========================================================
    // LOAD XML
    // =========================================================

    $dom = new DOMDocument();
    $dom->preserveWhiteSpace = true;
    $dom->formatOutput = false;
    $dom->load($xmlPath);

    $root = $dom->documentElement;

    // =========================================================
    // NAMESPACES
    // =========================================================

    $ns = [
        'ext'   => 'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2',
        'cac'   => 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
        'cbc'   => 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
        'sig'   => 'urn:oasis:names:specification:ubl:schema:xsd:CommonSignatureComponents-2',
        'sac'   => 'urn:oasis:names:specification:ubl:schema:xsd:SignatureAggregateComponents-2',
        'sbc'   => 'urn:oasis:names:specification:ubl:schema:xsd:SignatureBasicComponents-2',
        'ds'    => 'http://www.w3.org/2000/09/xmldsig#',
        'xades' => 'http://uri.etsi.org/01903/v1.3.2#'
    ];

    // =========================================================
    // REMOVE OLD EXTENSIONS
    // =========================================================

    $oldExts = $root->getElementsByTagNameNS(
        $ns['ext'],
        'UBLExtensions'
    );

    if ($oldExts->length > 0) {
        $root->removeChild($oldExts->item(0));
    }

    // =========================================================
    // CREATE UBLEXTENSIONS
    // =========================================================

    $ublExt = $dom->createElementNS(
        $ns['ext'],
        'ext:UBLExtensions'
    );

    $ublExtItem = $dom->createElementNS(
        $ns['ext'],
        'ext:UBLExtension'
    );

    $extUri = $dom->createElementNS(
        $ns['ext'],
        'ext:ExtensionURI',
        'urn:oasis:names:specification:ubl:dsig:enveloped:xades'
    );

    $extContent = $dom->createElementNS(
        $ns['ext'],
        'ext:ExtensionContent'
    );

    $ublExtItem->appendChild($extUri);
    $ublExtItem->appendChild($extContent);
    $ublExt->appendChild($ublExtItem);

    // =========================================================
    // SIGNATURE STRUCTURE
    // =========================================================

    $sigDoc = $dom->createElementNS(
        $ns['sig'],
        'sig:UBLDocumentSignatures'
    );

    $sigInfoEl = $dom->createElementNS(
        $ns['sac'],
        'sac:SignatureInformation'
    );

    $sigInfoId = $dom->createElementNS(
        $ns['cbc'],
        'cbc:ID',
        'urn:oasis:names:specification:ubl:signature:1'
    );

    $refSigId = $dom->createElementNS(
        $ns['sbc'],
        'sbc:ReferencedSignatureID',
        'urn:oasis:names:specification:ubl:signature:Invoice'
    );

    $sigInfoEl->appendChild($sigInfoId);
    $sigInfoEl->appendChild($refSigId);

    // =========================================================
    // DS SIGNATURE
    // =========================================================

    $dsSig = $dom->createElementNS(
        $ns['ds'],
        'ds:Signature'
    );

    $dsSig->setAttribute('Id', 'signature');

    $sigInfoEl->appendChild($dsSig);
    $sigDoc->appendChild($sigInfoEl);
    $extContent->appendChild($sigDoc);

    // =========================================================
    // SIGNED INFO
    // =========================================================

    $signedInfo = $dom->createElementNS(
        $ns['ds'],
        'ds:SignedInfo'
    );

    $dsSig->appendChild($signedInfo);

    $canonMethod = $dom->createElementNS(
        $ns['ds'],
        'ds:CanonicalizationMethod'
    );

    $canonMethod->setAttribute(
        'Algorithm',
        'http://www.w3.org/2001/10/xml-exc-c14n#'
    );

    $signedInfo->appendChild($canonMethod);

    $sigMethod = $dom->createElementNS(
        $ns['ds'],
        'ds:SignatureMethod'
    );

    $sigMethod->setAttribute(
        'Algorithm',
        'http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256'
    );

    $signedInfo->appendChild($sigMethod);

    // =========================================================
    // INVOICE REFERENCE
    // =========================================================

    $refInv = $dom->createElementNS(
        $ns['ds'],
        'ds:Reference'
    );

    $refInv->setAttribute('Id', 'invoiceSignedData');
    $refInv->setAttribute('URI', '');

    $signedInfo->appendChild($refInv);

    $transforms = $dom->createElementNS(
        $ns['ds'],
        'ds:Transforms'
    );

    $refInv->appendChild($transforms);

    $xpathExprs = [
        'not(//ancestor-or-self::ext:UBLExtensions)',
        'not(//ancestor-or-self::cac:Signature)',
        'not(//ancestor-or-self::cac:AdditionalDocumentReference[cbc:ID="QR"])'
    ];

    foreach ($xpathExprs as $expr) {

        $t = $dom->createElementNS(
            $ns['ds'],
            'ds:Transform'
        );

        $t->setAttribute(
            'Algorithm',
            'http://www.w3.org/TR/1999/REC-xpath-19991116'
        );

        $xpathNode = $dom->createElementNS(
            $ns['ds'],
            'ds:XPath',
            $expr
        );

        $t->appendChild($xpathNode);

        $transforms->appendChild($t);
    }

    $tC14n = $dom->createElementNS(
        $ns['ds'],
        'ds:Transform'
    );

    $tC14n->setAttribute(
        'Algorithm',
        'http://www.w3.org/2001/10/xml-exc-c14n#'
    );

    $transforms->appendChild($tC14n);

    $digestMethod = $dom->createElementNS(
        $ns['ds'],
        'ds:DigestMethod'
    );

    $digestMethod->setAttribute(
        'Algorithm',
        'http://www.w3.org/2001/04/xmlenc#sha256'
    );

    $refInv->appendChild($digestMethod);

    $digestValueElem = $dom->createElementNS(
        $ns['ds'],
        'ds:DigestValue',
        'PLACEHOLDER'
    );

    $refInv->appendChild($digestValueElem);

    // =========================================================
    // SIGNED PROPERTIES REFERENCE
    // =========================================================

    $refSp = $dom->createElementNS(
        $ns['ds'],
        'ds:Reference'
    );

    $refSp->setAttribute(
        'Type',
        'http://www.w3.org/2000/09/xmldsig#SignatureProperties'
    );

    $refSp->setAttribute(
        'URI',
        '#xadesSignedProperties'
    );

    $signedInfo->appendChild($refSp);

    $dmSp = $dom->createElementNS(
        $ns['ds'],
        'ds:DigestMethod'
    );

    $dmSp->setAttribute(
        'Algorithm',
        'http://www.w3.org/2001/04/xmlenc#sha256'
    );

    $refSp->appendChild($dmSp);

    $spDigestElem = $dom->createElementNS(
        $ns['ds'],
        'ds:DigestValue'
    );

    $refSp->appendChild($spDigestElem);

    // =========================================================
    // SIGNATURE VALUE
    // =========================================================

    $sigValueElem = $dom->createElementNS(
        $ns['ds'],
        'ds:SignatureValue',
        'PLACEHOLDER'
    );

    $dsSig->appendChild($sigValueElem);

    // =========================================================
    // KEY INFO
    // =========================================================

    $keyInfo = $dom->createElementNS(
        $ns['ds'],
        'ds:KeyInfo'
    );

    $dsSig->appendChild($keyInfo);

    $x509Data = $dom->createElementNS(
        $ns['ds'],
        'ds:X509Data'
    );

    $keyInfo->appendChild($x509Data);

    $x509Cert = $dom->createElementNS(
        $ns['ds'],
        'ds:X509Certificate',
        base64_encode($certDer)
    );

    $x509Data->appendChild($x509Cert);

    // =========================================================
    // XADES OBJECT
    // =========================================================

    $obj = $dom->createElementNS(
        $ns['ds'],
        'ds:Object'
    );

    $dsSig->appendChild($obj);

    $qualProps = $dom->createElementNS(
        $ns['xades'],
        'xades:QualifyingProperties'
    );

    $qualProps->setAttribute(
        'Target',
        '#signature'
    );

    $obj->appendChild($qualProps);

    $signedProps = $dom->createElementNS(
        $ns['xades'],
        'xades:SignedProperties'
    );

    $signedProps->setAttribute(
        'Id',
        'xadesSignedProperties'
    );

    $signedProps->setAttributeNS(
        'http://www.w3.org/2000/xmlns/',
        'xmlns:xades',
        $ns['xades']
    );

    $qualProps->appendChild($signedProps);

    $ssProps = $dom->createElementNS(
        $ns['xades'],
        'xades:SignedSignatureProperties'
    );

    $signedProps->appendChild($ssProps);

    $signingTime = $dom->createElementNS(
        $ns['xades'],
        'xades:SigningTime',
        gmdate('Y-m-d\TH:i:s\Z')
    );

    $ssProps->appendChild($signingTime);

    // =========================================================
    // SIGNING CERTIFICATE
    // =========================================================

    $signingCert = $dom->createElementNS(
        $ns['xades'],
        'xades:SigningCertificate'
    );

    $ssProps->appendChild($signingCert);

    $certObj = $dom->createElementNS(
        $ns['xades'],
        'xades:Cert'
    );

    $signingCert->appendChild($certObj);

    $certDigest = $dom->createElementNS(
        $ns['xades'],
        'xades:CertDigest'
    );

    $certObj->appendChild($certDigest);

    $cdDM = $dom->createElementNS(
        $ns['ds'],
        'ds:DigestMethod'
    );

    $cdDM->setAttribute(
        'Algorithm',
        'http://www.w3.org/2001/04/xmlenc#sha256'
    );

    $certDigest->appendChild($cdDM);

    // =========================================================
    // CERTIFICATE HASH
    // =========================================================

    $certHash = base64_encode(
        hash('sha256', $certDer, true)
    );

    $certDigestVal = $dom->createElementNS(
        $ns['ds'],
        'ds:DigestValue',
        $certHash
    );

    $certDigest->appendChild($certDigestVal);

    // =========================================================
    // ISSUER SERIAL
    // =========================================================

    $issuerSerial = $dom->createElementNS(
        $ns['xades'],
        'xades:IssuerSerial'
    );

    $certObj->appendChild($issuerSerial);

    $certRes = openssl_x509_read($certPem);

    if (!$certRes) {
        throw new Exception("Failed to parse certificate");
    }

    $certParsed = openssl_x509_parse($certRes);

    $issuerParts = [];

    foreach ($certParsed['issuer'] as $key => $val) {

        if (is_array($val)) {

            foreach ($val as $v) {
                $issuerParts[] = $key . '=' . $v;
            }

        } else {

            $issuerParts[] = $key . '=' . $val;
        }
    }

    $issuerName = implode(',', array_reverse($issuerParts));

    $serial = $certParsed['serialNumber'];

    if (!ctype_digit($serial) && ctype_xdigit($serial)) {

        $serial = function_exists('gmp_strval')
            ? gmp_strval(gmp_init($serial, 16), 10)
            : base_convert($serial, 16, 10);
    }

    $x509IssuerName = $dom->createElementNS(
        $ns['ds'],
        'ds:X509IssuerName',
        $issuerName
    );

    $x509SerialNumber = $dom->createElementNS(
        $ns['ds'],
        'ds:X509SerialNumber',
        $serial
    );

    $issuerSerial->appendChild($x509IssuerName);
    $issuerSerial->appendChild($x509SerialNumber);

    openssl_x509_free($certRes);

    // =========================================================
    // INSERT EXTENSIONS
    // =========================================================

    $root->insertBefore(
        $ublExt,
        $root->firstChild
    );

    $dom->save($signedPath);

    // =========================================================
    // PASS 1 - INVOICE HASH
    // =========================================================

    $tempDom = new DOMDocument();
    $tempDom->preserveWhiteSpace = true;
    $tempDom->load($signedPath);

    $xpath = new DOMXPath($tempDom);

    $this->registerNamespaces($xpath);

    foreach ($xpath->query('//ext:UBLExtensions') as $node) {
        $node->parentNode->removeChild($node);
    }

    foreach ($xpath->query('//cac:Signature') as $node) {
        $node->parentNode->removeChild($node);
    }

    foreach ($xpath->query('//cac:AdditionalDocumentReference[cbc:ID="QR"]') as $node) {
        $node->parentNode->removeChild($node);
    }

    $c14nBytes = $tempDom->C14N(true, false);

    $invoiceHash = base64_encode(
        hash('sha256', $c14nBytes, true)
    );

    // =========================================================
    // PASS 2 - SIGNED PROPERTIES
    // =========================================================

    $fileDom = new DOMDocument();
    $fileDom->preserveWhiteSpace = true;
    $fileDom->load($signedPath);

    $xpath = new DOMXPath($fileDom);

    $this->registerNamespaces($xpath);

    $invDigestNode = $xpath->query(
        '//ds:Reference[@Id="invoiceSignedData"]/ds:DigestValue'
    )->item(0);

    $invDigestNode->nodeValue = $invoiceHash;

    $signedPropsEl = $xpath->query(
        '//xades:SignedProperties'
    )->item(0);

    $c14nSp = $signedPropsEl->C14N(true, false);

    $spHash = base64_encode(
        hash('sha256', $c14nSp, true)
    );

    $spDigestNode = $xpath->query(
        '//ds:Reference[@URI="#xadesSignedProperties"]/ds:DigestValue'
    )->item(0);

    $spDigestNode->nodeValue = $spHash;

    // =========================================================
    // SIGN SIGNEDINFO
    // =========================================================

    $signedInfoEl = $xpath->query(
        '//ds:SignedInfo'
    )->item(0);

    $c14nSi = $signedInfoEl->C14N(true, false);

    $ok = openssl_sign(
        $c14nSi,
        $rawSignature,
        $privKeyId,
        OPENSSL_ALGO_SHA256
    );

    if (!$ok) {

        throw new Exception(
            "Signing failed: " .
            openssl_error_string()
        );
    }

    $signatureValue = base64_encode($rawSignature);

    $sigValueNode = $xpath->query(
        '//ds:SignatureValue'
    )->item(0);

    $sigValueNode->nodeValue = $signatureValue;

    $fileDom->save($signedPath);

    return $invoiceHash;
}



    // ------------------------------------------------------------------
    // QR generation (TLV with SPKI and CA signature bytes)
    // ------------------------------------------------------------------
    public function generateQr($signedPath, $invoiceHash, $privKeyPath, $certPath) {
        $dom = new DOMDocument();
        $dom->load($signedPath);
        $xpath = new DOMXPath($dom);
        $this->registerNamespaces($xpath);

        $getText = function($query) use ($xpath) {
            $node = $xpath->query($query)->item(0);
            return $node ? $node->nodeValue : '';
        };

        $sellerName = $getText('.//cac:AccountingSupplierParty/cac:Party/cac:PartyLegalEntity/cbc:RegistrationName');
        $sellerVat  = $getText('.//cac:AccountingSupplierParty/cac:Party/cac:PartyTaxScheme/cbc:CompanyID');
        $issueDate  = $getText('.//cbc:IssueDate');
        $issueTime  = $getText('.//cbc:IssueTime');
        $taxInclusive = $getText('.//cac:LegalMonetaryTotal/cbc:TaxInclusiveAmount');
        $vatTotal     = $getText('.//cac:TaxTotal/cbc:TaxAmount');
        $signatureB64 = $getText('.//ds:SignatureValue');

        if (!$signatureB64) throw new Exception("ds:SignatureValue not found in XML");

        // Load certificate
        $certB64 = trim(file_get_contents($certPath));
        $certDer = base64_decode($certB64);
        $certPem = "-----BEGIN CERTIFICATE-----\n" . chunk_split(base64_encode($certDer), 64, "\n") . "-----END CERTIFICATE-----\n";

        // Tag 8: SPKI in DER format
        $pubKey = openssl_pkey_get_public($certPem);
        $pubKeyDetails = openssl_pkey_get_details($pubKey);
        $spkiPem = $pubKeyDetails['key'];
        $spkiDer = base64_decode(str_replace(['-----BEGIN PUBLIC KEY-----', '-----END PUBLIC KEY-----', "\r", "\n"], '', $spkiPem));

        // Tag 9: CA signature bytes from certificate
        $certRes = openssl_x509_read($certPem);
        $certParsed = openssl_x509_parse($certRes);
        // Extract signatureValue from DER using openssl command or manual parse
        // Simple method: use openssl x509 -text and regex
        $tempCert = tempnam(sys_get_temp_dir(), 'cert_');
        file_put_contents($tempCert, $certPem);
        $output = shell_exec('"' . $this->opensslExe . '" x509 -in ' . escapeshellarg($tempCert) . ' -text -noout 2>&1');
        unlink($tempCert);
        $caSigBytes = '';
        if (preg_match_all('/Signature Value:\s+([0-9a-fA-F:\s]+)/', $output, $matches)) {
            $hex = str_replace([':', ' ', "\r", "\n"], '', end($matches[1]));
            $caSigBytes = hex2bin($hex);
        } else {
            $caSigBytes = str_repeat("\0", 64);
        }
        openssl_x509_free($certRes);

        // Build TLV
        $tlv = '';
        $fields = [
            1 => $sellerName,
            2 => $sellerVat,
            3 => $issueDate . 'T' . $issueTime,
            4 => $taxInclusive,
            5 => $vatTotal,
            6 => $invoiceHash,
            7 => $signatureB64
        ];
        foreach ($fields as $tag => $value) {
            $tlv .= $this->tlvEncode($tag, $value);
        }
        $tlv .= $this->tlvEncode(8, $spkiDer);
        $tlv .= $this->tlvEncode(9, $caSigBytes);

        return base64_encode($tlv);
    }

    // ------------------------------------------------------------------
    // Embed QR into signed XML
    // ------------------------------------------------------------------
    public function embedQrInXml($xmlPath, $qrBase64) {
        // Raw string substitution (NO DOM round-trip) preserves every byte of the file —
        // critical because signInvoice() computed the SignedProperties / invoice hashes
        // against this exact byte sequence. Any reformat would invalidate those hashes.
        //
        // Match BOTH forms of the empty QR placeholder:
        //   - self-closing:  <cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain"/>
        //   - open/close:    <cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain"></cbc:EmbeddedDocumentBinaryObject>
        // DOMDocument::save() emits empty elements as self-closing, so the placeholder
        // arrives here in self-closing form after signInvoice writes the file.
        //
        // Replacement always writes the open/close form with the QR base64 inside.
        $content = file_get_contents($xmlPath);
        $pattern = '#(<cac:AdditionalDocumentReference>\s*<cbc:ID>QR</cbc:ID>\s*<cac:Attachment>\s*<cbc:EmbeddedDocumentBinaryObject(?:\s[^>]*?)?)\s*(?:/>|>[^<]*</cbc:EmbeddedDocumentBinaryObject>)#s';
        $new = preg_replace_callback($pattern, function ($m) use ($qrBase64) {
            return $m[1] . '>' . $qrBase64 . '</cbc:EmbeddedDocumentBinaryObject>';
        }, $content, 1);
        if ($new !== null && $new !== $content) {
            file_put_contents($xmlPath, $new);
        }
    }

    // ------------------------------------------------------------------
    // Main invoice processing (same as Python internal_process_invoice)
    // ------------------------------------------------------------------
    public function processInvoice($invId, $invType) {
        try {
            if (!$this->sdkRoot) {
                return ["status" => "error", "message" => "SDK is not configured for this project."];
            }
            list($metadata, $xmlPath) = $this->createUblXml($invId, $invType);
            $customNo = $metadata['custom_inv_no'];
            $prevHash = $metadata['previous_invoice_hash'];

            $certPath = $this->sdkConfig['certPath'];
            $keyPath  = $this->sdkConfig['privateKeyPath'];
            $pihPath  = $this->sdkConfig['pihPath'];
            if (!file_exists($certPath) || !file_exists($keyPath)) {
                return ["status" => "error", "message" => "SDK cert/key missing.",
                        "certPath" => $certPath, "keyPath" => $keyPath];
            }

            if (!is_dir(dirname($pihPath))) @mkdir(dirname($pihPath), 0777, true);
            if (file_put_contents($pihPath, $prevHash) === false) {
                return ["status" => "error", "message" => "Cannot write PIH to $pihPath"];
            }

            $signedFile = str_replace('.xml', '_signed.xml', $xmlPath);
            $signOut = $this->runFatoora('-sign -invoice ' . self::shArg($xmlPath)
                                        . ' -signedInvoice ' . self::shArg($signedFile));
            if (stripos($signOut, 'signed successfully') === false) {
                return ["status" => "error", "message" => "SDK signing failed.",
                        "fatoora_output" => $signOut];
            }
            $invoiceHash = 'N/A';
            if (preg_match('/InvoiceSigningService\s*-\s*\*\*\*\s*INVOICE HASH\s*=\s*(\S+)/i', $signOut, $m)) {
                $invoiceHash = trim($m[1]);
            }

            $qrOut = $this->runFatoora('-qr -invoice ' . self::shArg($signedFile));
            if (!preg_match('/QR code\s*[:=]\s*(.+)/i', $qrOut, $qm)) {
                return ["status" => "error", "message" => "SDK QR generation failed.",
                        "fatoora_output" => $qrOut];
            }
            $qrBase64 = trim($qm[1]);

            // Persist PIH for next invoice; render QR PNG into the app's qrcode/ dir.
            file_put_contents($pihPath, $invoiceHash);
            QRcode::png($qrBase64, $this->qrDir . DIRECTORY_SEPARATOR . $customNo . ".png", QR_ECLEVEL_L, 4);

            return [
                "status" => "success",
                "message" => "Invoice $customNo signed via SDK.",
                "invoice_hash" => $invoiceHash,
                "qr_string" => $qrBase64,
                "customInvoiceNo" => $customNo,
                "metadata" => $metadata,
                "signed_file" => $signedFile,
            ];
        } catch (Exception $e) {
            return [
                "status"  => "error",
                "message" => $e->getMessage(),
                "debug"   => get_class($e) . ' at ' . basename($e->getFile()) . ':' . $e->getLine()
            ];
        }
    }

    // ------------------------------------------------------------------
    // Reporting / Clearance (send to ZATCA API)
    // ------------------------------------------------------------------
    public function reportInvoice($customInvNo, $metadata, $invoiceHash, $targetStatus = 'REPORTED') {
        $xmlPath = $this->xmlDir . DIRECTORY_SEPARATOR . $customInvNo . "_signed.xml";
        if (!file_exists($xmlPath)) return ["status" => "error", "message" => "Signed XML not found."];
        $encodedXml = base64_encode(file_get_contents($xmlPath));
        $uuid = $metadata['uuid'];

        $csr = $this->db->query("SELECT binarySecurityToken, secret FROM csr_info LIMIT 1")->fetch(PDO::FETCH_ASSOC);
        if (!$csr) return ["status" => "error", "message" => "CSR info not found."];

        $auth = base64_encode(trim($csr['binarySecurityToken']) . ":" . trim($csr['secret']));
        $payload = [
            "invoiceHash" => $invoiceHash,
            "uuid"        => $uuid,
            "invoice"     => $encodedXml
        ];

        // Save request payload BEFORE API call (compact single-line, same format as reference)
        file_put_contents(
            $this->jsonDir . DIRECTORY_SEPARATOR . $customInvNo . ".json",
            json_encode($payload)
        );

        $apiType = ($targetStatus === 'CLEARED') ? 'clearance' : 'reporting';
        $apiUrl  = $this->getInvoiceApiUrl($apiType);

        $ch = curl_init($apiUrl);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
        $this->applyCurlSsl($ch);
        curl_setopt($ch, CURLOPT_HTTPHEADER, [
            'Accept: application/json',
            'Accept-Version: V2',
            'Accept-Language: en',
            'Authorization: Basic ' . $auth,
            'Content-Type: application/json',
            'Clearance-Status: ' . ($targetStatus == "CLEARED" ? "1" : "0")
        ]);

        $response  = curl_exec($ch);
        $httpCode  = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlErr   = curl_error($ch);
        curl_close($ch);

        if ($response === false || $curlErr) {
            return ["status" => "error", "message" => "cURL failed: $curlErr"];
        }

        $data = json_decode($response, true);
        $isReported = isset($data['reportingStatus']) && $data['reportingStatus'] == 'REPORTED';
        $isCleared  = isset($data['clearanceStatus']) && $data['clearanceStatus'] == 'CLEARED';
        if (in_array($httpCode, [200, 202]) && ($isReported || $isCleared)) {
            $actualStatus = $data['reportingStatus'] ?? $data['clearanceStatus'];
            $reportVal    = ($targetStatus == "REPORTED") ? $actualStatus : null;
            $clearanceVal = ($targetStatus == "CLEARED")  ? $actualStatus : null;

            // Save to zatca_info regardless of warnings — only condition is REPORTED or CLEARED
            $dbError = null;
            try {
                $stmt = $this->db->prepare("INSERT INTO zatca_info
                    (custom_inv_no, pre_inv_id_hash, date, uuid, invoice_amount, invoiceType, signed_status, report_status, clearance_status)
                    VALUES (?,?,?,?,?,?,'SIGNED',?,?)
                    ON DUPLICATE KEY UPDATE
                        pre_inv_id_hash = VALUES(pre_inv_id_hash),
                        date            = VALUES(date),
                        uuid            = VALUES(uuid),
                        invoice_amount  = VALUES(invoice_amount),
                        invoiceType     = VALUES(invoiceType),
                        signed_status   = 'SIGNED',
                        report_status   = VALUES(report_status),
                        clearance_status= VALUES(clearance_status)");
                $ok = $stmt->execute([
                    $customInvNo,
                    $invoiceHash,
                    $metadata['now_str'],
                    $uuid,
                    $metadata['total_inv'],
                    $metadata['invoice_type_str'],
                    $reportVal,
                    $clearanceVal
                ]);
                if (!$ok) {
                    $ei = $stmt->errorInfo();
                    $dbError = "DB execute failed: [" . $ei[0] . "] " . $ei[2];
                }
            } catch (Exception $e) {
                $dbError = "DB exception: " . $e->getMessage();
            }

            file_put_contents($this->jsonDir . DIRECTORY_SEPARATOR . $customInvNo . "_res.json", json_encode($data, JSON_PRETTY_PRINT));
            $warnings = $data['validationResults']['warningMessages'] ?? [];
            $result = [
                "status"         => $httpCode,
                "message"        => "Invoice $actualStatus successfully.",
                "warnings"       => $warnings,
                "zatca_response" => $data
            ];
            if ($dbError) $result['db_error'] = $dbError;
            return $result;
        } else {
            return [
                "status"        => $httpCode,
                "message"       => "ZATCA API Error ($httpCode)",
                "zatca_response"=> $data,
                "zatca_raw"     => $response
            ];
        }
    }

    public function clearInvoice($customInvoiceNo) {
        $stmt = $this->db->prepare("DELETE FROM zatca_info WHERE custom_inv_no = ?");
        $stmt->execute([$customInvoiceNo]);
        return ["status" => "success", "message" => "Invoice $customInvoiceNo cleared."];
    }

    // ------------------------------------------------------------------
    // Onboarding methods (CSR generation, compliance, production, renew)
    // ------------------------------------------------------------------
    private function generateZatcaCsr($privKeyPath, $csrPath, $config) {
        // Step 1: generate secp256k1 private key (PKCS8 PEM) via OpenSSL CLI — no .cnf needed
        $cmdKey = '"' . $this->opensslExe . '" genpkey -algorithm EC'
                . ' -pkeyopt ec_paramgen_curve:secp256k1'
                . ' -out "' . $privKeyPath . '" 2>&1';
        $keyOut = shell_exec($cmdKey);
        if (!file_exists($privKeyPath) || filesize($privKeyPath) === 0) {
            throw new Exception("Failed to generate secp256k1 key. OpenSSL: " . trim($keyOut));
        }

        // Step 2: extract SubjectPublicKeyInfo as raw DER bytes
        $spkiTmp = tempnam(sys_get_temp_dir(), 'zatca_spki_');
        $cmdSpki = '"' . $this->opensslExe . '" pkey'
                 . ' -in "' . $privKeyPath . '"'
                 . ' -pubout -outform DER'
                 . ' -out "' . $spkiTmp . '" 2>&1';
        shell_exec($cmdSpki);
        if (!file_exists($spkiTmp) || filesize($spkiTmp) === 0) {
            @unlink($spkiTmp);
            throw new Exception("Failed to extract SubjectPublicKeyInfo from key.");
        }
        $spkiDer = file_get_contents($spkiTmp);
        @unlink($spkiTmp);

        // Step 3: load the private key into PHP for signing
        $privKeyPem = file_get_contents($privKeyPath);
        $privKeyId  = openssl_pkey_get_private($privKeyPem);
        if (!$privKeyId) {
            throw new Exception("Cannot load private key for signing: " . openssl_error_string());
        }

        // Step 4: build CertificationRequestInfo DER (mirrors Python CertificateSigningRequestBuilder)
        //   Version INTEGER 0, Subject Name, SubjectPublicKeyInfo, [0] Attributes
        $certReqInfo = $this->derSeqC(
            "\x02\x01\x00" .                    // version INTEGER 0
            $this->csrBuildSubject($config) .    // subject Name
            $spkiDer .                           // subjectPKInfo (from CLI)
            $this->csrBuildAttributes($config)   // [0] extensionRequest
        );

        // Step 5: sign CertificationRequestInfo with SHA-256 (ECDSA)
        if (!openssl_sign($certReqInfo, $rawSig, $privKeyId, OPENSSL_ALGO_SHA256) || !$rawSig) {
            openssl_free_key($privKeyId);
            throw new Exception("ECDSA signing failed: " . openssl_error_string());
        }
        openssl_free_key($privKeyId);

        // Step 6: assemble CertificationRequest DER
        //   signatureAlgorithm: ecdsa-with-SHA256 (1.2.840.10045.4.3.2), no NULL params
        $sigAlgDer = $this->derSeqC($this->derOid('2a8648ce3d040302'));
        $csrDer    = $this->derSeqC($certReqInfo . $sigAlgDer . $this->derBitStr($rawSig));

        // Step 7: write PEM (same format as Python csr.public_bytes(Encoding.PEM))
        $pem = "-----BEGIN CERTIFICATE REQUEST-----\r\n"
             . chunk_split(base64_encode($csrDer), 64, "\r\n")
             . "-----END CERTIFICATE REQUEST-----\r\n";
        file_put_contents($csrPath, $pem);
    }

    public function generateCsr($config) {
        $propsPath = $this->inputDir . DIRECTORY_SEPARATOR . 'csr-config-template.properties';
        $keyPath = $this->certDir . DIRECTORY_SEPARATOR . 'cert.key';
        $csrPath = $this->certDir . DIRECTORY_SEPARATOR . 'cert.csr';

        // Write properties file (for reference)
        $props = "csr.common.name=" . ($config['cn'] ?: '') . "\n"
               . "csr.serial.number=" . ($config['sn'] ?: '') . "\n"
               . "csr.organization.identifier=" . ($config['uid'] ?: '') . "\n"
               . "csr.organization.unit.name=" . ($config['ou'] ?: '') . "\n"
               . "csr.organization.name=" . ($config['org'] ?: '') . "\n"
               . "csr.country.name=" . ($config['country'] ?: 'SA') . "\n"
               . "csr.invoice.type=" . ($config['title'] ?: '') . "\n"
               . "csr.location.address=" . ($config['address'] ?: '') . "\n"
               . "csr.industry.business.category=" . ($config['business_category'] ?: '') . "\n";
        file_put_contents($propsPath, $props);

        $this->generateZatcaCsr($keyPath, $csrPath, $config);
        return ['csr' => file_get_contents($csrPath), 'key' => file_get_contents($keyPath)];
    }

    public function submitCompliance($otp, $csrContent) {
        $csrDerB64 = base64_encode($csrContent);
        $payload = ["csr" => $csrDerB64];
        $ch = curl_init($this->zatcaApiBase . "/compliance");
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
        $this->applyCurlSsl($ch);
        curl_setopt($ch, CURLOPT_HTTPHEADER, [
            'Accept: application/json',
            'Accept-Version: V2',
            'OTP: ' . $otp,
            'Content-Type: application/json'
        ]);
        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        $data = json_decode($response, true);
        if ($httpCode == 200) {
            $outer = base64_decode(trim($data['binarySecurityToken']));
            $innerB64 = trim($outer);
            $certPath = $this->certDir . DIRECTORY_SEPARATOR . 'cert.pem';
            file_put_contents($certPath, $innerB64);

            $stmt = $this->db->prepare("UPDATE csr_info SET binarySecurityToken=?, secret=?, requestID=?, csr_otp=?, dispositionMessage=? WHERE id=1");
            $stmt->execute([
                $data['binarySecurityToken'],
                $data['secret'],
                $data['requestID'],
                $otp,
                $data['dispositionMessage']
            ]);

            // Convert private key to raw base64 format
            $keyPath = $this->certDir . DIRECTORY_SEPARATOR . 'cert.key';
            $keyContent = file_get_contents($keyPath);
            $cleanKey = preg_replace('/---.*---/', '', $keyContent);
            $cleanKey = str_replace(["\r", "\n", " "], '', $cleanKey);
            $privDest = $this->certDir . DIRECTORY_SEPARATOR . 'ec-secp256k1-priv-key.pem';
            file_put_contents($privDest, $cleanKey);

            file_put_contents($this->pihFile, "NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==");

            return ["ok" => true, "output" => "Compliance CSID obtained.", "data" => $data];
        } else {
            return ["ok" => false, "output" => "API Error $httpCode: " . ($response ?: 'No response')];
        }
    }

    public function submitProduction($otp = "") {
        $stmt = $this->db->query("SELECT binarySecurityToken, secret, requestID FROM csr_info LIMIT 1");
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$row || !$row['binarySecurityToken'] || !$row['requestID']) {
            return ["ok" => false, "output" => "Missing compliance data."];
        }
        $auth = base64_encode(trim($row['binarySecurityToken']) . ":" . trim($row['secret']));
        $payload = ["compliance_request_id" => (string)$row['requestID']];

        $ch = curl_init($this->zatcaApiBase . "/production/csids");
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
        $this->applyCurlSsl($ch);
        curl_setopt($ch, CURLOPT_HTTPHEADER, [
            'Accept: application/json',
            'Accept-Version: V2',
            'Authorization: Basic ' . $auth,
            'Content-Type: application/json'
        ]);

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        $data = json_decode($response, true);
        if ($httpCode == 200) {
            $outer = base64_decode(trim($data['binarySecurityToken']));
            $innerB64 = trim($outer);
            $certPath = $this->certDir . DIRECTORY_SEPARATOR . 'cert.pem';
            file_put_contents($certPath, $innerB64);

            $stmt = $this->db->prepare("UPDATE csr_info SET binarySecurityToken=?, secret=?, csr_otp=?, dispositionMessage='ISSUED' WHERE id=1");
            $stmt->execute([$data['binarySecurityToken'], $data['secret'], $otp]);

            file_put_contents($this->pihFile, "NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==");
            return ["ok" => true, "output" => "Production CSID obtained.", "data" => $data];
        } else {
            return ["ok" => false, "output" => "API Error $httpCode: " . ($response ?: 'No response')];
        }
    }

    public function renewCsid($config, $otp) {
        $stmt = $this->db->query("SELECT binarySecurityToken, secret FROM csr_info LIMIT 1");
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$row || !$row['binarySecurityToken']) {
            return ["ok" => false, "output" => "No existing production token found."];
        }
        if (empty($otp)) return ["ok" => false, "output" => "OTP required for renewal."];

        $csrData = $this->generateCsr($config);
        $auth = base64_encode(trim($row['binarySecurityToken']) . ":" . trim($row['secret']));
        $csrDerB64 = base64_encode($csrData['csr']);
        $payload = ["csr" => $csrDerB64];

        $ch = curl_init($this->zatcaApiBase . "/production/csids");
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_CUSTOMREQUEST, 'PATCH');
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
        $this->applyCurlSsl($ch);
        curl_setopt($ch, CURLOPT_HTTPHEADER, [
            'Accept: application/json',
            'Accept-Version: V2',
            'OTP: ' . $otp,
            'Authorization: Basic ' . $auth,
            'Content-Type: application/json'
        ]);

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        $data = json_decode($response, true);
        if ($httpCode == 200) {
            $outer = base64_decode(trim($data['binarySecurityToken']));
            $innerB64 = trim($outer);
            $certPath = $this->certDir . DIRECTORY_SEPARATOR . 'cert.pem';
            file_put_contents($certPath, $innerB64);

            $stmt = $this->db->prepare("UPDATE csr_info SET binarySecurityToken=?, secret=?, csr_otp=?, dispositionMessage='ISSUED' WHERE id=1");
            $stmt->execute([$data['binarySecurityToken'], $data['secret'], $otp]);

            file_put_contents($this->pihFile, "NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==");
            return ["ok" => true, "output" => "PCSID renewed successfully.", "data" => $data];
        } else {
            return ["ok" => false, "output" => "API Error $httpCode: " . ($response ?: 'No response')];
        }
    }

    // ==================================================================
    // SDK INTEGRATION
    //
    // Discovers a ZATCA Java SDK install, repairs its config.json if stale,
    // and shells out to fatoora.bat for signing + QR generation. Discovery
    // is silent on miss — sdkRoot stays null and processInvoice returns a
    // clean error envelope.
    // ==================================================================

    /**
     * Discovery order (first hit wins):
     *   1. sAdmin/site/zatca/sdk.local.json  → { "configPath": "..." }
     *   2. SDK_CONFIG env var
     *   3. FATOORA_HOME env var
     *   4. Local glob: <project>/sAdmin/site/zatca/zatca-einvoicing-sdk-*
     */
    private function loadSdk() {
        $configPath = null;
        $localPtr = $this->scriptDir . DIRECTORY_SEPARATOR . 'sdk.local.json';
        if (is_file($localPtr)) {
            $j = json_decode(file_get_contents($localPtr), true);
            if (is_array($j) && !empty($j['configPath']) && is_file($j['configPath'])) {
                $configPath = $j['configPath'];
            }
        }
        if (!$configPath) {
            $envCfg = getenv('SDK_CONFIG');
            if ($envCfg && is_file($envCfg)) $configPath = $envCfg;
        }
        if (!$configPath) {
            $fatooraHome = getenv('FATOORA_HOME');
            if ($fatooraHome && is_dir($fatooraHome)) {
                $candidate = dirname(rtrim($fatooraHome, "\\/")) . DIRECTORY_SEPARATOR
                           . 'Configuration' . DIRECTORY_SEPARATOR . 'config.json';
                if (is_file($candidate)) $configPath = $candidate;
            }
        }
        if (!$configPath) {
            $matches = glob($this->scriptDir . DIRECTORY_SEPARATOR . 'zatca-einvoicing-sdk-*', GLOB_ONLYDIR);
            foreach ($matches as $dir) {
                $candidate = $dir . DIRECTORY_SEPARATOR . 'Configuration' . DIRECTORY_SEPARATOR . 'config.json';
                if (is_file($candidate)) { $configPath = $candidate; break; }
            }
        }
        if (!$configPath) {
            // Silent miss — sdkRoot remains null. processInvoice will report cleanly.
            $this->sdkRoot = null;
            return;
        }

        $this->sdkRoot = dirname(dirname($configPath));

        // Canonical SDK layout — paths derived directly from sdkRoot. Same
        // shape config.json uses; published as $this->sdkConfig so processInvoice
        // and getSdkInfo can read individual entries.
        $sdkData = $this->sdkRoot . DIRECTORY_SEPARATOR . 'Data';
        $this->sdkConfig = [
            'certPath'       => $sdkData . DIRECTORY_SEPARATOR . 'Certificates' . DIRECTORY_SEPARATOR . 'cert.pem',
            'privateKeyPath' => $sdkData . DIRECTORY_SEPARATOR . 'Certificates' . DIRECTORY_SEPARATOR . 'ec-secp256k1-priv-key.pem',
            'pihPath'        => $sdkData . DIRECTORY_SEPARATOR . 'PIH' . DIRECTORY_SEPARATOR . 'pih.txt',
            'inputPath'      => $sdkData . DIRECTORY_SEPARATOR . 'Input',
        ];

        $appsDir = $this->sdkRoot . DIRECTORY_SEPARATOR . 'Apps';
        $batPath = $appsDir . DIRECTORY_SEPARATOR . 'fatoora.bat';
        $shPath  = $appsDir . DIRECTORY_SEPARATOR . 'fatoora';
        if (is_file($batPath))      $this->fatooraCmd = $batPath;
        else if (is_file($shPath))  $this->fatooraCmd = $shPath;
        else                        $this->fatooraCmd = 'fatoora';

        // Cache the SDK jar + parsed version so we can bypass fatoora.bat and
        // invoke `java` directly with tuned JVM flags — much faster cold start.
        $jars = glob($appsDir . DIRECTORY_SEPARATOR . 'zatca-einvoicing-sdk-*.jar');
        $this->sdkJar = $jars ? $jars[0] : null;
        $this->sdkVersion = $this->sdkJar
            ? preg_replace('/^zatca-einvoicing-sdk-(.+)\.jar$/', '$1', basename($this->sdkJar))
            : null;
    }

    public function getSdkInfo() {
        if (!$this->sdkRoot) return ["sdk_root" => null, "message" => "SDK not configured"];
        return [
            'sdk_root'   => $this->sdkRoot,
            'fatooraCmd' => $this->fatooraCmd,
            'certPath'   => isset($this->sdkConfig['certPath'])       ? $this->sdkConfig['certPath']       : null,
            'keyPath'    => isset($this->sdkConfig['privateKeyPath']) ? $this->sdkConfig['privateKeyPath'] : null,
            'pihPath'    => isset($this->sdkConfig['pihPath'])        ? $this->sdkConfig['pihPath']        : null,
            'inputPath'  => isset($this->sdkConfig['inputPath'])      ? $this->sdkConfig['inputPath']      : null,
        ];
    }

    /**
     * Invoke the SDK. Calls `java` directly with the jar (bypassing
     * fatoora.bat + jq.exe + cmd.exe overhead) and adds JVM flags that
     * trim ~300-800 ms off cold start:
     *   -Xshare:auto              — Class Data Sharing
     *   -XX:TieredStopAtLevel=1   — skip the tier-4 JIT; this is a one-shot CLI
     *   -Djava.awt.headless=true  — skip AWT/font initialisation
     *   -Xms64m -Xmx256m          — pre-size heap to avoid early GC growth
     * Falls back to fatoora.bat if the jar wasn't found at load time.
     */
    private function runFatoora($args) {
        $appsDir = $this->sdkRoot . DIRECTORY_SEPARATOR . 'Apps';
        $cwd = is_dir($appsDir) ? $appsDir : $this->sdkRoot;
        $sdkConfig = $this->sdkRoot . DIRECTORY_SEPARATOR . 'Configuration' . DIRECTORY_SEPARATOR . 'config.json';
        $javaBin = $this->discoverJavaBin();
        $javaExe = $javaBin
            ? $javaBin . DIRECTORY_SEPARATOR . (DIRECTORY_SEPARATOR === '\\' ? 'java.exe' : 'java')
            : 'java';

        if ($this->sdkJar && $this->sdkVersion) {
            $jvmFlags = '-Xshare:auto -XX:TieredStopAtLevel=1 -Djava.awt.headless=true '
                      . '-Djdk.module.illegalAccess=deny -Dfile.encoding=UTF-8 -Xms64m -Xmx256m';
            $core = self::shArg($javaExe) . ' ' . $jvmFlags . ' '
                  . '-jar ' . self::shArg($this->sdkJar) . ' '
                  . '--globalVersion ' . $this->sdkVersion . ' '
                  . $args;
        } else {
            // Jar missing — fall back to the SDK's bat launcher
            $core = self::shArg($this->fatooraCmd) . ' ' . $args;
        }

        if (DIRECTORY_SEPARATOR === '\\') {
            $cmd = 'set "FATOORA_HOME=' . $appsDir . '" && '
                 . 'set "SDK_CONFIG=' . $sdkConfig . '" && '
                 . $core . ' 2>&1';
        } else {
            $cmd = 'FATOORA_HOME=' . escapeshellarg($appsDir)
                 . ' SDK_CONFIG=' . escapeshellarg($sdkConfig) . ' '
                 . $core . ' 2>&1';
        }

        $descr = [1 => ['pipe', 'w'], 2 => ['pipe', 'w']];
        $proc = proc_open($cmd, $descr, $pipes, $cwd);
        if (!is_resource($proc)) return '';
        $stdout = stream_get_contents($pipes[1]); fclose($pipes[1]);
        $stderr = stream_get_contents($pipes[2]); fclose($pipes[2]);
        proc_close($proc);
        return trim($stdout . $stderr);
    }

    /**
     * Pull the embedded QR base64 out of a signed invoice XML. The SDK fills
     * <AdditionalDocumentReference ID="QR"> during -sign, so we don't need a
     * second JVM cold-start just to call -qr.
     */
    private function extractEmbeddedQr($signedPath) {
        if (!is_file($signedPath)) return '';
        $xml = @file_get_contents($signedPath);
        if ($xml === false) return '';
        // DOMDocument + XPath would also work, but a tight regex skips the parse cost.
        if (preg_match(
            '#<cac:AdditionalDocumentReference[^>]*>\s*<cbc:ID>QR</cbc:ID>.*?<cbc:EmbeddedDocumentBinaryObject[^>]*>([^<]+)</cbc:EmbeddedDocumentBinaryObject>#is',
            $xml, $m
        )) {
            return trim($m[1]);
        }
        return '';
    }

    private function discoverJavaBin() {
        $javaHome = getenv('JAVA_HOME');
        if ($javaHome) {
            $bin = rtrim($javaHome, "\\/") . DIRECTORY_SEPARATOR . 'bin';
            if (is_file($bin . DIRECTORY_SEPARATOR . 'java.exe') || is_file($bin . DIRECTORY_SEPARATOR . 'java')) {
                return $bin;
            }
        }
        if (DIRECTORY_SEPARATOR === '\\') {
            $patterns = [
                'C:\\Program Files\\Java\\*\\bin\\java.exe',
                'C:\\Program Files\\java\\*\\bin\\java.exe',
                'C:\\Program Files (x86)\\Java\\*\\bin\\java.exe',
                'C:\\Program Files (x86)\\java\\*\\bin\\java.exe',
            ];
            foreach ($patterns as $p) {
                $hits = glob($p);
                if ($hits) { sort($hits); return dirname(end($hits)); }
            }
        }
        return '';
    }

    private static function shArg($s) {
        if (DIRECTORY_SEPARATOR === '\\') {
            return '"' . str_replace('"', '""', $s) . '"';
        }
        return escapeshellarg($s);
    }
}
?>